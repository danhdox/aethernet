#!/usr/bin/env node

import fs from "node:fs";
import {
  AethernetRuntime,
  createDefaultConfig,
  decryptWalletAccount,
  loadConfig,
  validateConfigDiagnostics,
  writeConfig,
} from "@aethernet/core-runtime";
import { startLocalApi } from "@aethernet/local-api";
import {
  providerCapabilityMatrix,
  ApiComputeProvider,
  KubernetesComputeProvider,
  InMemoryComputeProvider,
  SelfHostComputeProvider,
} from "@aethernet/provider-interface";
import { Erc8004Client, findChainProfile } from "@aethernet/protocol-identity";
import { InMemoryMessagingTransport, XmtpMessagingTransport } from "@aethernet/protocol-messaging";
import { x402Fetch } from "@aethernet/protocol-payments";
import type { AgentConfig, HexAddress } from "@aethernet/shared-types";
import { configNeedsOnboarding, runOnboarding } from "./onboarding.js";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "setup":
      await handleSetup(rest);
      return;
    case "init":
      await handleInit();
      return;
    case "run":
      await handleRun(rest);
      return;
    case "status":
      await handleStatus();
      return;
    case "wallet":
      await handleWallet(rest);
      return;
    case "identity":
      await handleIdentity(rest);
      return;
    case "register":
      await handleRegister(rest);
      return;
    case "auth":
      await handleAuth(rest);
      return;
    case "pay":
      await handlePay(rest);
      return;
    case "earn":
      await handleEarn(rest);
      return;
    case "msg":
      await handleMessage(rest);
      return;
    case "skills":
      await handleSkills(rest);
      return;
    case "memory":
      await handleMemory(rest);
      return;
    case "tools":
      await handleTools(rest);
      return;
    case "config":
      await handleConfig(rest);
      return;
    case "replicate":
      await handleReplicate(rest);
      return;
    case "emergency-stop":
      await handleEmergencyStop(rest);
      return;
    case "emergency-clear":
      await handleEmergencyClear();
      return;
    default:
      printHelp();
  }
}

async function handleSetup(args: string[]): Promise<void> {
  if (args[0] && args[0] !== "wizard") {
    throw new Error(`Unknown setup subcommand: ${args[0]}`);
  }
  const defaults = createDefaultConfig();
  const existing = fsExistsSafe(defaults.configPath) ? loadConfigOrDefault(defaults) : defaults;
  const { config, walletImported, walletCreated } = await runOnboarding(existing);
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "setup",
        configPath: config.configPath,
        chainDefault: config.chainDefault,
        provider: config.providerName,
        model: config.brain.model,
        walletImported,
        walletCreated,
      },
      null,
      2,
    ),
  );
}

async function handleInit(): Promise<void> {
  const config = loadConfig();
  writeConfig(config);

  const runtime = new AethernetRuntime(config, {
    provider: resolveProvider(config),
  });
  const initialized = runtime.initialize();
  const walletMeta = runtime.getWalletMeta();

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "init",
        name: config.name,
        address: initialized.address,
        walletCreated: initialized.walletCreated,
        wallet: walletMeta,
        configPath: config.configPath,
        dbPath: config.dbPath,
      },
      null,
      2,
    ),
  );

  runtime.close();
}

async function handleRun(args: string[]): Promise<void> {
  const dryRun = args.includes("--dry");
  const once = args.includes("--once") || dryRun;
  const daemon = args.includes("--daemon") || !once;
  const intervalMs = Number(getOption(args, "--interval-ms") ?? NaN);
  const prompt = getOption(args, "--prompt");

  const defaultConfig = createDefaultConfig();
  const config = configNeedsOnboarding(defaultConfig.configPath)
    ? (await runOnboarding(
      fsExistsSafe(defaultConfig.configPath) ? loadConfigOrDefault(defaultConfig) : defaultConfig,
    )).config
    : loadConfig();
  const provider = resolveProvider(config);
  const runtime = new AethernetRuntime(config, {
    provider,
    messaging: resolveMessagingTransport(config),
  });
  runtime.initialize();

  if (daemon && !dryRun) {
    process.once("SIGINT", () => runtime.stopDaemon());
    process.once("SIGTERM", () => runtime.stopDaemon());
    await runtime.runDaemon({
      intervalMs: Number.isFinite(intervalMs) ? intervalMs : undefined,
      onTick: (output) => {
        if (config.debug) {
          console.log(output);
        }
      },
    });
    runtime.close();
    return;
  }

  if (once) {
    const output = await runtime.run({ dryRun, prompt: prompt ?? undefined });
    console.log(output);
    runtime.close();
    return;
  }
}

async function handleStatus(): Promise<void> {
  const config = loadConfig();
  const provider = resolveProvider(config);
  const runtime = new AethernetRuntime(config, { provider });
  runtime.initialize();

  console.log(
    JSON.stringify(
      {
        status: runtime.status(),
        wallet: runtime.getWalletMeta(),
        unlocked: runtime.isWalletUnlocked(),
        provider: provider.name,
        providerCapabilities: providerCapabilityMatrix(provider),
        db: runtime.db.health(),
        incidents: runtime.db.listRuntimeIncidents(20),
        providerEvents: runtime.db.listProviderEvents(20),
      },
      null,
      2,
    ),
  );

  runtime.close();
}

async function handleWallet(args: string[]): Promise<void> {
  const sub = args[0];
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();

  if (sub === "unlock") {
    const passphrase = getOption(args, "--passphrase") ?? process.env.AETHERNET_WALLET_PASSPHRASE;
    const ttlSec = Number(getOption(args, "--ttl-sec") ?? config.walletSessionTtlSec);
    if (!passphrase) {
      runtime.close();
      throw new Error("Wallet unlock requires --passphrase or AETHERNET_WALLET_PASSPHRASE.");
    }
    const result = runtime.unlockWallet(passphrase, ttlSec);
    console.log(JSON.stringify({ ok: true, action: "unlock", ...result }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "lock") {
    runtime.lockWallet();
    console.log(JSON.stringify({ ok: true, action: "lock", locked: true }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "rotate") {
    const oldPassphrase =
      getOption(args, "--old-passphrase") ?? process.env.AETHERNET_WALLET_OLD_PASSPHRASE;
    const newPassphrase =
      getOption(args, "--new-passphrase") ?? process.env.AETHERNET_WALLET_NEW_PASSPHRASE;
    if (!oldPassphrase || !newPassphrase) {
      runtime.close();
      throw new Error(
        "Wallet rotate requires --old-passphrase and --new-passphrase (or env vars AETHERNET_WALLET_OLD_PASSPHRASE / AETHERNET_WALLET_NEW_PASSPHRASE).",
      );
    }
    const result = runtime.rotateWallet(oldPassphrase, newPassphrase);
    console.log(JSON.stringify({ ok: true, action: "rotate", ...result }, null, 2));
    runtime.close();
    return;
  }

  console.log(
    JSON.stringify(
      {
        address: runtime.getAddress(),
        wallet: runtime.getWalletMeta(),
        unlocked: runtime.isWalletUnlocked(),
        homeDir: config.homeDir,
      },
      null,
      2,
    ),
  );

  runtime.close();
}

async function handleIdentity(args: string[]): Promise<void> {
  const sub = args[0];
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();
  const chainProfile = resolveChainProfile(config, getOption(args, "--chain"));
  ensureChainFeature(chainProfile, "identity");
  const client = new Erc8004Client(chainProfile);

  if (sub === "query") {
    const agentId = parseNumberOption(args, "--agent-id");
    const result = await client.queryAgent(agentId);
    console.log(JSON.stringify({ ok: true, query: result, chain: chainProfile.caip2 }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "update") {
    const agentId = parseNumberOption(args, "--agent-id");
    const uri = getOption(args, "--uri");
    if (!uri) {
      runtime.close();
      throw new Error("Usage: aethernet identity update --agent-id <id> --uri <new-uri> [--chain <caip2|chainId>]");
    }
    const result = await client.updateAgentURI(runtime.getAccount(), agentId, uri);
    runtime.db.upsertRegistryEntry({
      agentId,
      chainId: chainProfile.chainId,
      registryAddress: chainProfile.identityRegistry,
      ownerAddress: runtime.getAddress() as HexAddress,
      agentUri: uri,
      txHash: result.txHash,
    });
    console.log(JSON.stringify({ ok: true, action: "update", agentId, chain: chainProfile.caip2, txHash: result.txHash }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "feedback") {
    const agentId = parseNumberOption(args, "--agent-id");
    const score = parseNumberOption(args, "--score");
    if (score < 0 || score > 100) {
      runtime.close();
      throw new Error("Score must be in [0,100]");
    }
    const comment = getOption(args, "--comment") ?? "";
    const result = await client.leaveFeedback(runtime.getAccount(), agentId, score, comment);
    runtime.db.insertReputationEntry({
      fromAddress: runtime.getAddress() as HexAddress,
      toAgentId: agentId,
      chainId: chainProfile.chainId,
      score,
      comment: comment || undefined,
      txHash: result.txHash,
    });
    console.log(JSON.stringify({ ok: true, action: "feedback", agentId, score, chain: chainProfile.caip2, txHash: result.txHash }, null, 2));
    runtime.close();
    return;
  }

  runtime.close();
  throw new Error(`Unknown identity subcommand: ${sub}`);
}

async function handleRegister(args: string[]): Promise<void> {
  const agentUri = getOption(args, "--uri") ?? "https://aethernet.local/agent-card.json";
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();

  const chainProfile = resolveChainProfile(config, getOption(args, "--chain"));
  ensureChainFeature(chainProfile, "identity");
  const client = new Erc8004Client(chainProfile);
  const result = await client.registerAgent(runtime.getAccount(), agentUri);

  runtime.db.setIdentity("agent_id", String(result.agentId));
  runtime.db.setIdentity("agent_registry", `${result.chainId}:${result.registryAddress}`);
  runtime.db.upsertRegistryEntry({
    agentId: result.agentId,
    chainId: result.chainId,
    registryAddress: result.registryAddress,
    ownerAddress: runtime.getAddress() as HexAddress,
    agentUri,
    txHash: result.txHash,
  });

  console.log(JSON.stringify({ ok: true, ...result, chain: chainProfile.caip2 }, null, 2));
  runtime.close();
}

async function handleAuth(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "signin") {
    const config = loadConfig();
    const runtime = new AethernetRuntime(config);
    runtime.initialize();

    const chainProfile = findChainProfile(config.chainDefault, config.chainProfiles);
    const receiptSecret = process.env.AETHERNET_RECEIPT_SECRET ?? "dev-receipt-secret";

    console.log(
      JSON.stringify(
        {
          ok: true,
          message: "Use /v1/auth/nonce then /v1/auth/verify for SIWA sign-in.",
          chainId: chainProfile.chainId,
          expectedDomain: `localhost:${config.localApiPort}`,
          receiptSecretSet: Boolean(receiptSecret),
        },
        null,
        2,
      ),
    );
    runtime.close();
    return;
  }

  throw new Error(`Unknown auth subcommand: ${sub}`);
}

async function handlePay(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "fetch") {
    const url = args[1];
    if (!url) {
      throw new Error("Usage: aethernet pay fetch <url>");
    }

    const config = loadConfig();
    const runtime = new AethernetRuntime(config);
    runtime.initialize();

    const result = await x402Fetch(url, runtime.getAccount());
    console.log(JSON.stringify(result, null, 2));
    runtime.close();
    return;
  }

  if (sub === "events") {
    const limit = Number(getOption(args, "--limit") ?? 50);
    const config = loadConfig();
    const runtime = new AethernetRuntime(config);
    runtime.initialize();
    console.log(JSON.stringify({ events: runtime.db.listPaymentEvents(limit) }, null, 2));
    runtime.close();
    return;
  }

  throw new Error(`Unknown pay subcommand: ${sub}`);
}

async function handleEarn(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== "serve") {
    throw new Error(`Unknown earn subcommand: ${sub}`);
  }

  const config = loadConfig();
  const runtime = new AethernetRuntime(config, {
    provider: resolveProvider(config),
    messaging: resolveMessagingTransport(config),
  });
  runtime.initialize();

  const chainProfile = findChainProfile(config.chainDefault, config.chainProfiles);
  const receiptSecret = process.env.AETHERNET_RECEIPT_SECRET ?? "dev-receipt-secret";
  const nonceSecret = process.env.AETHERNET_NONCE_SECRET ?? receiptSecret;

  await startLocalApi({
    runtime,
    chainProfile,
    receiptSecret,
    nonceSecret,
    port: config.localApiPort,
    facilitator:
      process.env.AETHERNET_X402_VERIFY_URL && process.env.AETHERNET_X402_SETTLE_URL
        ? {
            verifyUrl: process.env.AETHERNET_X402_VERIFY_URL,
            settleUrl: process.env.AETHERNET_X402_SETTLE_URL,
            apiKey: process.env.AETHERNET_X402_FACILITATOR_KEY,
          }
        : undefined,
  });

  console.log(`Local API started on http://localhost:${config.localApiPort}`);
}

async function handleMessage(args: string[]): Promise<void> {
  const sub = args[0];
  const config = loadConfig();
  const runtime = new AethernetRuntime(config, {
    messaging: resolveMessagingTransport(config),
  });
  runtime.initialize();

  if (sub === "send") {
    const to = getOption(args, "--to") ?? args[1];
    const content = getOption(args, "--content") ?? args.slice(2).join(" ");
    const threadId = getOption(args, "--thread-id");

    if (!to || !content) {
      throw new Error("Usage: aethernet msg send --to <addr|inboxId> --content <text> [--thread-id <id>]");
    }

    const result = await runtime.sendMessage({
      to,
      content,
      threadId: threadId ?? undefined,
    });

    console.log(JSON.stringify({ sent: true, id: result.id }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "poll") {
    const limit = Number(getOption(args, "--limit") ?? 50);
    const since = getOption(args, "--since");
    const messages = await runtime.pollMessageInbox({ limit, since: since ?? undefined });
    console.log(JSON.stringify({ messages }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "threads") {
    const limit = Number(getOption(args, "--limit") ?? 100);
    const threads = await runtime.listMessageThreads(limit);
    console.log(JSON.stringify({ threads }, null, 2));
    runtime.close();
    return;
  }

  runtime.close();
  throw new Error(`Unknown msg subcommand: ${sub}`);
}

async function handleSkills(args: string[]): Promise<void> {
  const sub = args[0] ?? "list";
  const config = loadConfig();
  const runtime = new AethernetRuntime(config, {
    provider: resolveProvider(config),
  });
  runtime.initialize();

  if (sub === "list") {
    console.log(JSON.stringify({ skills: runtime.listSkills() }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "enable") {
    const id = args[1];
    if (!id) {
      throw new Error("Usage: aethernet skills enable <id>");
    }
    const updated = runtime.setSkillEnabled(id, true);
    console.log(JSON.stringify({ ok: true, ...updated }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "disable") {
    const id = args[1];
    if (!id) {
      throw new Error("Usage: aethernet skills disable <id>");
    }
    const updated = runtime.setSkillEnabled(id, false);
    console.log(JSON.stringify({ ok: true, ...updated }, null, 2));
    runtime.close();
    return;
  }

  runtime.close();
  throw new Error(`Unknown skills subcommand: ${sub}`);
}

async function handleMemory(args: string[]): Promise<void> {
  const sub = args[0];
  const limit = Number(getOption(args, "--limit") ?? 200);
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();

  if (sub === "facts") {
    console.log(JSON.stringify({ facts: runtime.listMemoryFacts(limit) }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "episodes") {
    console.log(JSON.stringify({ episodes: runtime.listMemoryEpisodes(limit) }, null, 2));
    runtime.close();
    return;
  }

  runtime.close();
  throw new Error("Usage: aethernet memory <facts|episodes> [--limit <n>]");
}

async function handleReplicate(args: string[]): Promise<void> {
  const sub = args[0];
  const config = loadConfig();
  const provider = resolveProvider(config);

  if (sub !== "spawn") {
    if (sub === "status") {
      const runtime = new AethernetRuntime(config, { provider });
      runtime.initialize();
      console.log(
        JSON.stringify(
          {
            children: runtime.db.listChildren(),
            lineage: runtime.db.listLineage(),
          },
          null,
          2,
        ),
      );
      runtime.close();
      return;
    }

    if (sub === "stop") {
      const identifier = args[1];
      if (!identifier) {
        throw new Error("Usage: aethernet replicate stop <childId|sandboxId>");
      }

      const runtime = new AethernetRuntime(config, { provider });
      runtime.initialize();
      const child = runtime.updateChildStatusByIdentifier(identifier, "stopped");
      console.log(JSON.stringify({ stopped: true, identifier, child }, null, 2));
      runtime.close();
      return;
    }

    if (sub === "resume") {
      const identifier = args[1];
      if (!identifier) {
        throw new Error("Usage: aethernet replicate resume <childId|sandboxId>");
      }

      const runtime = new AethernetRuntime(config, { provider });
      runtime.initialize();
      const child = runtime.resumeChild(identifier);
      console.log(JSON.stringify({ resumed: true, identifier, child }, null, 2));
      runtime.close();
      return;
    }

    if (sub === "delete") {
      const identifier = args[1];
      if (!identifier) {
        throw new Error("Usage: aethernet replicate delete <childId|sandboxId> [--no-destroy]");
      }

      const runtime = new AethernetRuntime(config, { provider });
      runtime.initialize();
      const destroySandbox = !args.includes("--no-destroy");
      const child = await runtime.terminateChild(identifier, destroySandbox);
      console.log(JSON.stringify({ deleted: true, identifier, destroyed: destroySandbox, child }, null, 2));
      runtime.close();
      return;
    }

    throw new Error(`Unknown replicate subcommand: ${sub}`);
  }

  const name = getOption(args, "--name") ?? "aethernet-child";
  const genesisPrompt =
    getOption(args, "--genesis") ??
    "You are a sovereign child runtime. Operate under immutable laws and earn your existence.";
  const initialFundingUsdc = getOption(args, "--funding") ?? "0.00";

  const runtime = new AethernetRuntime(config, { provider });
  runtime.initialize();
  const result = await runtime.replicate({
    name,
    genesisPrompt,
    creatorAddress: config.creatorAddress,
    parentAddress: runtime.getAddress() as `0x${string}`,
    initialFundingUsdc,
  });

  console.log(JSON.stringify({ spawned: true, ...result, provider: provider.name }, null, 2));
  runtime.close();
}

async function handleTools(args: string[]): Promise<void> {
  const sub = args[0] ?? "sources";
  const config = loadConfig();
  const runtime = new AethernetRuntime(config, {
    provider: resolveProvider(config),
    messaging: resolveMessagingTransport(config),
  });
  runtime.initialize();

  if (sub === "sources" || sub === "list") {
    console.log(JSON.stringify({ sources: runtime.listToolSources() }, null, 2));
    runtime.close();
    return;
  }

  if (sub === "invoke") {
    const sourceId = getOption(args, "--source");
    const toolName = getOption(args, "--tool");
    if (!sourceId || !toolName) {
      runtime.close();
      throw new Error("Usage: aethernet tools invoke --source <id> --tool <name> [--input <json>]");
    }
    const inputRaw = getOption(args, "--input");
    const parsedInput = inputRaw ? safeParseJson(inputRaw) : {};
    const result = await runtime.invokeTool({
      sourceId,
      toolName,
      input: parsedInput,
    });
    console.log(JSON.stringify(result, null, 2));
    runtime.close();
    return;
  }

  runtime.close();
  throw new Error(`Unknown tools subcommand: ${sub}`);
}

async function handleConfig(args: string[]): Promise<void> {
  const sub = args[0] ?? "validate";
  if (sub !== "validate") {
    throw new Error(`Unknown config subcommand: ${sub}`);
  }

  const config = loadConfig();
  const diagnostics = validateConfigDiagnostics(config);
  const errors = diagnostics.filter((item) => item.severity === "error");
  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        diagnostics,
      },
      null,
      2,
    ),
  );
}

async function handleEmergencyClear(): Promise<void> {
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();
  runtime.clearEmergencyStop();
  console.log(JSON.stringify({ stopped: false, resumed: true }, null, 2));
  runtime.close();
}

async function handleEmergencyStop(args: string[]): Promise<void> {
  const reason = args.join(" ") || "manual emergency stop";
  const config = loadConfig();
  const runtime = new AethernetRuntime(config);
  runtime.initialize();
  runtime.emergencyStop(reason);
  console.log(JSON.stringify({ stopped: true, reason }, null, 2));
  runtime.close();
}

function resolveProvider(config: AgentConfig) {
  const provider = (process.env.AETHERNET_PROVIDER ?? config.providerName).trim().toLowerCase();
  if (provider === "api") {
    if (!config.providerApiKey) {
      throw new Error("AETHERNET_PROVIDER=api requires AETHERNET_PROVIDER_API_KEY");
    }
    return new ApiComputeProvider({
      apiUrl: config.providerApiUrl,
      apiKey: config.providerApiKey,
    });
  }

  if (provider === "kubernetes") {
    return new KubernetesComputeProvider({
      namespace: process.env.AETHERNET_K8S_NAMESPACE,
      image: process.env.AETHERNET_K8S_IMAGE,
      command: process.env.AETHERNET_K8S_COMMAND,
      context: process.env.AETHERNET_K8S_CONTEXT,
      kubeconfig: process.env.AETHERNET_K8S_KUBECONFIG,
      podNamePrefix: process.env.AETHERNET_K8S_POD_PREFIX ?? "aethernet-sandbox",
      execTimeoutMs: Number(process.env.AETHERNET_K8S_EXEC_TIMEOUT_MS ?? 30_000),
    });
  }

  if (provider === "in-memory") {
    return new InMemoryComputeProvider();
  }

  return new SelfHostComputeProvider({
    rootDir: process.env.AETHERNET_SANDBOX_ROOT_DIR,
  });
}

function resolveMessagingTransport(
  config: AgentConfig,
  account?: { address: HexAddress; signMessage(input: { message: string }): Promise<string> },
) {
  const signer =
    account ??
    (() => {
      const passphrase = process.env.AETHERNET_WALLET_PASSPHRASE;
      if (!passphrase) {
        throw new Error(
          "Messaging transport requires wallet access. Set AETHERNET_WALLET_PASSPHRASE or provide account context.",
        );
      }
      return decryptWalletAccount(config, passphrase);
    })();

  const env = process.env.AETHERNET_XMTP_ENV as "local" | "dev" | "production" | undefined;
  const enabled = (process.env.AETHERNET_XMTP_ENABLED ?? "true") !== "false";
  if (!enabled) {
    return new InMemoryMessagingTransport(signer);
  }

  return new XmtpMessagingTransport({
    account: signer,
    env: env ?? "dev",
    dbPath: process.env.AETHERNET_XMTP_DB_PATH ?? undefined,
  });
}

function resolveChainProfile(config: AgentConfig, value?: string): ReturnType<typeof findChainProfile> {
  if (!value) {
    return findChainProfile(config.chainDefault, config.chainProfiles);
  }
  if (/^\d+$/.test(value)) {
    return findChainProfile(Number(value), config.chainProfiles);
  }
  return findChainProfile(value, config.chainProfiles);
}

function ensureChainFeature(
  profile: ReturnType<typeof findChainProfile>,
  feature: "identity" | "reputation" | "payments" | "auth" | "messaging",
): void {
  if (profile.supports?.[feature] === false) {
    throw new Error(`Chain ${profile.caip2} does not support ${feature}`);
  }
}

function parseNumberOption(args: string[], key: string): number {
  const raw = getOption(args, key);
  const numeric = raw ? Number(raw) : NaN;
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected numeric value for ${key}`);
  }
  return numeric;
}

function getOption(args: string[], key: string): string | undefined {
  const idx = args.findIndex((value) => value === key);
  if (idx === -1) {
    return undefined;
  }

  return args[idx + 1];
}

function fsExistsSafe(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function loadConfigOrDefault(fallback: AgentConfig): AgentConfig {
  try {
    return loadConfig();
  } catch {
    return fallback;
  }
}

function printHelp(): void {
  console.log(`
aethernet commands:
  aethernet setup wizard
  aethernet init
  aethernet run --daemon [--interval-ms <ms>]   # default mode
  aethernet run --once [--dry] [--prompt <text>]
  aethernet status
  aethernet wallet
  aethernet wallet unlock [--ttl-sec <sec>] [--passphrase <value>]
  aethernet wallet lock
  aethernet wallet rotate --old-passphrase <value> --new-passphrase <value>
  aethernet register --uri <agentURI> [--chain <caip2|chainId>]
  aethernet identity query --agent-id <id> [--chain <caip2|chainId>]
  aethernet identity update --agent-id <id> --uri <new-uri> [--chain <caip2|chainId>]
  aethernet identity feedback --agent-id <id> --score <0-100> [--comment <text>] [--chain <caip2|chainId>]
  aethernet auth signin
  aethernet pay fetch <url>
  aethernet pay events [--limit <n>]
  aethernet earn serve
  aethernet msg send --to <addr|inboxId> --content <text> [--thread-id <id>]
  aethernet msg poll [--limit <n>] [--since <iso-time>]
  aethernet msg threads [--limit <n>]
  aethernet skills list
  aethernet skills enable <id>
  aethernet skills disable <id>
  aethernet memory facts [--limit <n>]
  aethernet memory episodes [--limit <n>]
  aethernet tools sources
  aethernet tools invoke --source <id> --tool <name> [--input <json>]
  aethernet config validate
  aethernet replicate spawn [--name <name>] [--genesis <prompt>] [--funding <usdc>]
  aethernet replicate status
  aethernet replicate stop <childId|sandboxId>
  aethernet replicate resume <childId|sandboxId>
  aethernet replicate delete <childId|sandboxId> [--no-destroy]
  aethernet emergency-stop [reason]
  aethernet emergency-clear
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
