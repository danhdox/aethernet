import fs from "node:fs";
import { execSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createDefaultConfig,
  ensureWallet,
  importWalletPrivateKey,
  walletExists,
  writeConfig,
} from "@aethernet/core-runtime";
import type { AgentConfig } from "@aethernet/shared-types";

const CORE_SKILL_IDS = ["planning.core", "web3.read", "messaging.core"];

export function configNeedsOnboarding(configPath: string): boolean {
  if (!fs.existsSync(configPath)) {
    return true;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const hasBrain = Boolean(raw.brain && typeof raw.brain === "object");
    const hasAutonomy = Boolean(raw.autonomy && typeof raw.autonomy === "object");
    const hasAlerting = Boolean(raw.alerting && typeof raw.alerting === "object");
    const hasTooling = Boolean(raw.tooling && typeof raw.tooling === "object");
    const brain = hasBrain ? raw.brain as Record<string, unknown> : {};
    const autonomy = hasAutonomy ? raw.autonomy as Record<string, unknown> : {};
    const tooling = hasTooling ? raw.tooling as Record<string, unknown> : {};
    return !(
      typeof raw.providerName === "string" &&
      typeof raw.providerApiUrl === "string" &&
      typeof raw.skillsDir === "string" &&
      Array.isArray(raw.enabledSkillIds) &&
      hasBrain &&
      hasAutonomy &&
      hasAlerting &&
      hasTooling &&
      typeof tooling.allowExternalSources === "boolean" &&
      typeof brain.timeoutMs === "number" &&
      typeof brain.maxRetries === "number" &&
      typeof autonomy.maxBrainFailuresBeforeStop === "number"
    );
  } catch {
    return true;
  }
}

export async function runOnboarding(existing?: AgentConfig): Promise<{
  config: AgentConfig;
  walletImported: boolean;
  walletCreated: boolean;
}> {
  const config = existing ?? createDefaultConfig();
  const rl = readline.createInterface({ input, output });

  output.write("\nAethernet onboarding\n");
  output.write("Press enter to accept defaults.\n\n");

  try {
    config.name = await ask(rl, "Agent name", config.name);
    config.genesisPrompt = await ask(rl, "Genesis prompt", config.genesisPrompt);
    config.brain.model = await ask(rl, "Brain model", config.brain.model);
    config.brain.apiKeyEnv = await ask(rl, "Brain API key env var", config.brain.apiKeyEnv);
    config.brain.maxOutputTokens = Number(
      await ask(rl, "Brain max output tokens", String(config.brain.maxOutputTokens)),
    );
    config.brain.timeoutMs = Number(
      await ask(rl, "Brain timeout ms", String(config.brain.timeoutMs)),
    );
    config.brain.maxRetries = Number(
      await ask(rl, "Brain max retries", String(config.brain.maxRetries)),
    );

    const walletDefault = walletExists(config) ? "existing" : "create";
    const walletMode = (await ask(rl, "Wallet mode [create/import/existing]", walletDefault)).toLowerCase();
    const walletImported = walletMode === "import";
    const walletCreated = walletMode === "create" && !walletExists(config);
    let passphrase = "";
    if (walletMode === "create" || walletMode === "import") {
      passphrase = await askSecret(rl, "Wallet passphrase");
      const confirm = await askSecret(rl, "Confirm wallet passphrase");
      if (passphrase !== confirm) {
        throw new Error("Wallet passphrase confirmation did not match.");
      }
    }

    if (walletImported) {
      const privateKey = await ask(rl, "Private key (0x...)", "");
      importWalletPrivateKey(config, privateKey as `0x${string}`, passphrase);
    } else if (walletMode === "create") {
      ensureWallet(config, { passphrase });
    }

    const selectedChains = await ask(
      rl,
      "Active chains (comma-separated CAIP2)",
      config.chainProfiles.map((profile) => profile.caip2).join(","),
    );
    const allowed = new Set(
      selectedChains
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const filtered = config.chainProfiles.filter((profile) => allowed.has(profile.caip2));
    if (filtered.length > 0) {
      config.chainProfiles = filtered;
    }
    const suggestedDefault = config.chainProfiles.some((item) => item.caip2 === config.chainDefault)
      ? config.chainDefault
      : config.chainProfiles[0]?.caip2 ?? config.chainDefault;
    config.chainDefault = (await ask(rl, "Default chain", suggestedDefault)) as AgentConfig["chainDefault"];

    const providerName = await ask(rl, "Provider [selfhost/kubernetes/api/in-memory]", config.providerName);
    config.providerName = toProviderName(providerName);
    if (config.providerName === "api") {
      config.providerApiUrl = await ask(rl, "Provider API URL", config.providerApiUrl);
      const providerApiKey = await ask(rl, "Provider API key (optional)", config.providerApiKey ?? "");
      config.providerApiKey = providerApiKey || undefined;
    }

    const messaging = (await ask(rl, "Messaging transport [xmtp/in-memory]", "xmtp")).toLowerCase();
    process.env.AETHERNET_XMTP_ENABLED = messaging === "in-memory" ? "false" : "true";

    const verifyUrl = await ask(rl, "x402 verify URL (optional)", process.env.AETHERNET_X402_VERIFY_URL ?? "");
    const settleUrl = await ask(rl, "x402 settle URL (optional)", process.env.AETHERNET_X402_SETTLE_URL ?? "");
    if (verifyUrl) process.env.AETHERNET_X402_VERIFY_URL = verifyUrl;
    if (settleUrl) process.env.AETHERNET_X402_SETTLE_URL = settleUrl;

    const skillsRaw = await ask(
      rl,
      "Enabled skills (comma-separated IDs)",
      CORE_SKILL_IDS.join(","),
    );
    const enabledSkills = skillsRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    config.enabledSkillIds = enabledSkills.length ? enabledSkills : CORE_SKILL_IDS;
    config.tooling.allowExternalSources = toBoolean(
      await ask(
        rl,
        "Allow external tool sources [true/false]",
        String(config.tooling.allowExternalSources),
      ),
      config.tooling.allowExternalSources,
    );

    config.autonomy.defaultIntervalMs = Number(
      await ask(rl, "Autonomy interval ms", String(config.autonomy.defaultIntervalMs)),
    );
    config.autonomy.maxActionsPerTurn = Number(
      await ask(rl, "Autonomy max actions per turn", String(config.autonomy.maxActionsPerTurn)),
    );
    config.autonomy.maxConsecutiveErrors = Number(
      await ask(
        rl,
        "Autonomy max consecutive errors",
        String(config.autonomy.maxConsecutiveErrors),
      ),
    );
    config.autonomy.maxBrainFailuresBeforeStop = Number(
      await ask(
        rl,
        "Autonomy max brain failures before stop",
        String(config.autonomy.maxBrainFailuresBeforeStop),
      ),
    );
    config.autonomy.allowSelfModifyAction = toBoolean(
      await ask(
        rl,
        "Allow autonomous self_modify action [true/false]",
        String(config.autonomy.allowSelfModifyAction),
      ),
      config.autonomy.allowSelfModifyAction,
    );
    config.autonomy.strictActionAllowlist = true;

    const alertRoute = await ask(rl, "Alert route [db/stdout/webhook]", config.alerting.route);
    config.alerting.route = toAlertRoute(alertRoute);
    config.alerting.enabled = toBoolean(
      await ask(rl, "Enable alerts [true/false]", String(config.alerting.enabled)),
      config.alerting.enabled,
    );
    config.alerting.criticalIncidentThreshold = Number(
      await ask(
        rl,
        "Alert threshold: critical incidents",
        String(config.alerting.criticalIncidentThreshold),
      ),
    );
    config.alerting.brainFailureThreshold = Number(
      await ask(
        rl,
        "Alert threshold: brain failures",
        String(config.alerting.brainFailureThreshold),
      ),
    );
    config.alerting.queueDepthThreshold = Number(
      await ask(
        rl,
        "Alert threshold: queue depth",
        String(config.alerting.queueDepthThreshold),
      ),
    );
    config.alerting.evaluationWindowMinutes = Number(
      await ask(
        rl,
        "Alert evaluation window minutes",
        String(config.alerting.evaluationWindowMinutes),
      ),
    );
    if (config.alerting.route === "webhook") {
      config.alerting.webhookUrl = await ask(
        rl,
        "Alert webhook URL",
        config.alerting.webhookUrl ?? "",
      );
    }

    writeConfig(config);
    return {
      config,
      walletImported,
      walletCreated,
    };
  } finally {
    rl.close();
  }
}

async function ask(
  rl: readline.Interface,
  label: string,
  fallback: string,
): Promise<string> {
  const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
  return answer || fallback;
}

function toProviderName(inputValue: string): AgentConfig["providerName"] {
  const value = inputValue.trim().toLowerCase();
  if (value === "selfhost" || value === "kubernetes" || value === "api" || value === "in-memory") {
    return value;
  }
  return "selfhost";
}

function toAlertRoute(inputValue: string): AgentConfig["alerting"]["route"] {
  const value = inputValue.trim().toLowerCase();
  if (value === "db" || value === "stdout" || value === "webhook") {
    return value;
  }
  return "db";
}

function toBoolean(inputValue: string, fallback: boolean): boolean {
  const value = inputValue.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

async function askSecret(rl: readline.Interface, label: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    return ask(rl, label, "");
  }

  output.write(`${label}: `);
  let echoDisabled = false;
  try {
    execSync("stty -echo");
    echoDisabled = true;
  } catch {
    return ask(rl, label, "");
  }

  try {
    const value = (await rl.question("")).trim();
    output.write("\n");
    if (!value) {
      throw new Error(`${label} is required.`);
    }
    return value;
  } finally {
    if (echoDisabled) {
      execSync("stty echo");
    }
  }
}
