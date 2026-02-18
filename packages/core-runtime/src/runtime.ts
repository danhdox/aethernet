import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentConfig,
  AgentMessage,
  AgentStatus,
  BrainAction,
  BrainProvider,
  BrainTurnInput,
  BrainTurnOutput,
  ComputeProvider,
  MessagingTransport,
  ReplicationPlan,
  RuntimeIncidentCode,
  SkillRecord,
  SurvivalTier,
  ToolInvocationRequest,
  ToolInvocationResult,
  ToolSourceConfig,
} from "@aethernet/shared-types";
import { AethernetDatabase, type ChildRecord, type ChildStatus } from "@aethernet/state";
import type { PrivateKeyAccount } from "viem";
import {
  ensureRuntimeDirectories,
  ensureLawTemplates,
} from "./config.js";
import {
  decryptWalletAccount,
  ensureWallet,
  getWalletAddress,
  readWalletMeta,
  rotateWalletPassphrase,
  walletPath,
} from "./wallet.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ensureConstitutionFiles,
  isProtectedPath,
  verifyAndPersistConstitutionHashes,
} from "./constitution.js";
import { createBrainProvider } from "./brain/index.js";
import { loadSkillRecords, ensureSkillDirectory } from "./skills/loader.js";
import { validateBrainTurnOutput } from "./autonomy/validation.js";
import { InternalToolAdapter } from "./tools/internal.js";
import { ReadOnlyApiToolAdapter } from "./tools/read-only-api.js";
import { ToolSourceRegistry } from "./tools/registry.js";

const SELF_MOD_WINDOW_MS = 60 * 60 * 1000;
const SELF_MOD_LIMIT_PER_WINDOW = 6;
const SELF_MOD_RATE_TTL_KEY = "self_mod_timestamps_v1";
const SELF_MOD_BACKUP_KEY_PREFIX = "self_mod_backup_v1:";
const BRAIN_FAILURE_STREAK_KEY = "brain_failure_streak_v1";
const ALLOWED_AUTONOMY_ACTIONS = new Set<BrainAction["type"]>([
  "send_message",
  "replicate",
  "self_modify",
  "record_fact",
  "record_episode",
  "invoke_tool",
  "sleep",
  "noop",
]);

interface InboundRuntimeCommand {
  type: "self_mod" | "replicate" | "noop";
  targetPath?: string;
  content?: string;
  plan?: {
    name: string;
    genesisPrompt: string;
    initialFundingUsdc?: string;
    metadata?: Record<string, string>;
  };
}

export interface RuntimeDependencies {
  db?: AethernetDatabase;
  provider?: ComputeProvider;
  messaging?: MessagingTransport;
  brain?: BrainProvider;
}

export class AethernetRuntime {
  readonly config: AgentConfig;
  readonly db: AethernetDatabase;
  private readonly provider?: ComputeProvider;
  private readonly messaging?: MessagingTransport;
  private readonly brain: BrainProvider;
  private readonly toolRegistry: ToolSourceRegistry;
  private account?: PrivateKeyAccount;
  private unlockedUntil: number | null = null;
  private daemonRunning = false;
  private initialized = false;

  constructor(config: AgentConfig, dependencies: RuntimeDependencies = {}) {
    this.config = config;
    this.db = dependencies.db ?? new AethernetDatabase({ dbPath: config.dbPath });
    this.provider = dependencies.provider;
    this.messaging = dependencies.messaging;
    this.brain = dependencies.brain ?? createBrainProvider(config.brain);
    this.toolRegistry = new ToolSourceRegistry({
      sources: this.buildToolSources(config.toolSources),
      allowExternalSources: config.tooling.allowExternalSources,
      adapters: [
        new InternalToolAdapter(this.internalToolHandlers()),
        new ReadOnlyApiToolAdapter(),
      ],
    });
  }

  initialize(): { address: string; walletCreated: boolean } {
    ensureRuntimeDirectories(this.config);
    ensureLawTemplates(this.config);
    ensureSkillDirectory(this.config);

    this.db.runMigrations();

    const passphrase = process.env.AETHERNET_WALLET_PASSPHRASE;
    const wallet = ensureWallet(this.config, { passphrase });
    const address = wallet.address;
    const walletMeta = readWalletMeta(this.config);
    this.db.setIdentity("wallet_address", address);
    this.db.setIdentity("wallet_path", walletPath(this.config));
    this.db.upsertWalletKeystoreMeta({
      address,
      path: walletPath(this.config),
      encrypted: true,
      createdAt: walletMeta.createdAt,
      updatedAt: walletMeta.updatedAt,
    });

    this.initialized = true;

    if (passphrase) {
      this.unlockWallet(passphrase, this.config.walletSessionTtlSec);
    }

    ensureConstitutionFiles(this.config.constitutionPolicy);
    verifyAndPersistConstitutionHashes(this.db, this.config.constitutionPolicy);

    if (!this.db.getKV("started_at")) {
      this.db.setKV("started_at", new Date().toISOString());
    }
    if (!this.db.getKV("self_child_id")) {
      this.db.setKV("self_child_id", `root_${crypto.randomUUID()}`);
    }
    if (!this.db.getKV("enabled_skill_ids")) {
      this.db.setJsonKV("enabled_skill_ids", this.config.enabledSkillIds);
    }
    if (!this.db.getKV(BRAIN_FAILURE_STREAK_KEY)) {
      this.db.setKV(BRAIN_FAILURE_STREAK_KEY, "0");
    }

    this.db.setAgentState("waking");
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "initialize",
      details: `runtime initialized with wallet ${address}`,
    });
    this.db.setAgentState("sleeping");

    if (this.provider) {
      const capabilityMatrix = {
        createSandbox: typeof this.provider.createSandbox === "function",
        destroySandbox: typeof this.provider.destroySandbox === "function",
        exec: typeof this.provider.exec === "function",
        writeFile: typeof this.provider.writeFile === "function",
        fundWallet: typeof this.provider.fundWallet === "function",
        getSandboxStatus: typeof this.provider.getSandboxStatus === "function",
        getSandboxLogs: typeof this.provider.getSandboxLogs === "function",
      };
      const capabilities = Object.entries(capabilityMatrix).map(([key, value]) => `${key}=${value}`);
      const missing = Object.entries(capabilityMatrix)
        .filter(([, value]) => !value)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(
          `Provider startup health check failed (${this.provider.name}): missing capabilities ${missing.join(", ")}`,
        );
      }
      this.db.insertProviderEvent({
        provider: this.provider.name,
        event: "startup_health",
        metadata: {
          status: "ok",
          capabilities,
        },
      });
    }

    return {
      address,
      walletCreated: wallet.isNew,
    };
  }

  getAccount(): PrivateKeyAccount {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.account || (this.unlockedUntil !== null && Date.now() >= this.unlockedUntil)) {
      this.lockWallet();
      throw new Error("Wallet is locked. Unlock first with aethernet wallet unlock.");
    }

    return this.account;
  }

  getAddress(): string {
    if (this.account) {
      return this.account.address;
    }
    return getWalletAddress(this.config);
  }

  getWalletMeta() {
    this.ensureInitialized();
    return readWalletMeta(this.config);
  }

  isWalletUnlocked(): boolean {
    return Boolean(this.account) && Boolean(this.unlockedUntil && Date.now() < this.unlockedUntil);
  }

  unlockWallet(passphrase: string, ttlSec = this.config.walletSessionTtlSec): {
    address: string;
    sessionId: string;
    expiresAt: string;
  } {
    this.ensureInitialized();
    const account = decryptWalletAccount(this.config, passphrase);
    this.account = account;
    this.unlockedUntil = Date.now() + ttlSec * 1000;
    const expiresAt = new Date(this.unlockedUntil).toISOString();
    const sessionId = this.db.createUnlockSession({
      address: account.address,
      expiresAt,
    });
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "wallet",
      action: "unlock",
      details: `ttlSec=${ttlSec}`,
    });

    return {
      address: account.address,
      sessionId,
      expiresAt,
    };
  }

  lockWallet(): void {
    this.account = undefined;
    this.unlockedUntil = null;
    this.db.revokeUnlockSessions();
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "wallet",
      action: "lock",
      details: "wallet locked",
    });
  }

  rotateWallet(oldPassphrase: string, newPassphrase: string): {
    address: string;
    path: string;
    updatedAt: string;
  } {
    this.ensureInitialized();
    const meta = rotateWalletPassphrase(this.config, oldPassphrase, newPassphrase);
    this.db.upsertWalletKeystoreMeta({
      address: meta.address,
      path: meta.path,
      encrypted: meta.encrypted,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    });
    this.lockWallet();
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "wallet",
      action: "rotate",
      details: `wallet rotated for ${meta.address}`,
    });
    return {
      address: meta.address,
      path: meta.path,
      updatedAt: meta.updatedAt,
    };
  }

  async run(input: { dryRun?: boolean; prompt?: string } = {}): Promise<string> {
    this.ensureInitialized();

    const emergency = this.db.getEmergencyState();
    if (emergency.enabled) {
      throw new Error(`Emergency stop is active: ${emergency.reason ?? "no reason provided"}`);
    }

    const survivalTier = this.evaluateSurvivalTier();
    this.db.setAgentState(survivalTier === "normal" ? "running" : survivalTier);
    if (survivalTier === "dead") {
      throw new Error("Runtime halted: survival tier is dead");
    }

    let output = "Autonomy turn complete.";

    if (input.dryRun) {
      output = "Dry run complete: runtime safeguards and autonomous loop skeleton executed.";
      this.db.insertTurn({
        state: "running",
        input: input.prompt,
        output,
        metadata: {
          dryRun: true,
          inboundMessageCount: 0,
          actionCount: 0,
        },
      });
      this.db.insertAudit({
        timestamp: new Date().toISOString(),
        category: "runtime",
        action: "run_dry",
        details: input.prompt,
      });
      this.db.setAgentState("sleeping");
      return output;
    }

    await this.syncMessagingInbox();
    const queueDepthAtStart = this.db.countMessages();
    const inbound = this.db.pollMessages(25);
    const inboxMessages: AgentMessage[] = inbound.map((message) => ({
      id: message.id,
      from: message.sender,
      to: message.receiver,
      content: message.content,
      threadId: message.threadId,
      receivedAt: message.receivedAt,
    }));
    for (const message of inbound) {
      this.db.markMessageProcessed(message.id);
    }

    const skills = this.listSkills();
    const recentTurns = this.db.getRecentTurns(20);
    const memoryFacts = this.db.listMemoryFacts(150);
    const memoryEpisodes = this.db.listMemoryEpisodes(150);
    const latestSurvival = this.db.getLatestSurvivalSnapshot();
    const estimatedUsd = latestSurvival?.estimatedUsd ?? this.estimateLiquidityUsd();

    const brainInput: BrainTurnInput = {
      agent: {
        name: this.config.name,
        address: this.getAddress() as `0x${string}`,
        creatorAddress: this.config.creatorAddress,
        chain: this.config.chainDefault,
      },
      survivalTier,
      estimatedUsd,
      operatorPrompt: input.prompt,
      inboxMessages,
      recentTurns,
      memory: {
        facts: memoryFacts,
        episodes: memoryEpisodes,
      },
      skills,
      toolSources: this.toolRegistry.listSources().map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        enabled: source.enabled,
      })),
      availableActions: [
        "send_message",
        "replicate",
        "self_modify",
        "record_fact",
        "record_episode",
        "invoke_tool",
        "sleep",
        "noop",
      ],
    };

    let brainOutput: BrainTurnOutput;
    let brainDurationMs = 0;
    let brainFailed = false;
    const brainStartedAt = Date.now();
    try {
      brainOutput = await this.brain.generateTurn(brainInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.insertRuntimeIncident({
        code: "BRAIN_REQUEST_FAILED",
        severity: "error",
        category: "brain",
        message: `Brain generation failed: ${message}`,
      });
      brainOutput = {
        summary: `Brain failure: ${message}`,
        nextActions: [{ type: "noop", reason: "brain_failure" }],
        integrity: "malformed",
      };
      brainFailed = true;
    } finally {
      brainDurationMs = Date.now() - brainStartedAt;
    }

    const validation = validateBrainTurnOutput(
      brainOutput,
      {
        maxActions: this.config.autonomy.maxActionsPerTurn,
        maxSleepMs: this.config.autonomy.maxSleepMs,
      },
      {
        strictAllowlist: this.config.autonomy.strictActionAllowlist,
        allowlist: ALLOWED_AUTONOMY_ACTIONS,
      },
    );
    const validated = validation.output;

    if (validation.malformed) {
      brainFailed = true;
      this.db.insertRuntimeIncident({
        code: "BRAIN_OUTPUT_MALFORMED",
        severity: "error",
        category: "brain",
        message: "Brain output failed validation; turn forced into fail-closed mode.",
        metadata: {
          validationErrors: validation.errors,
        },
      });
    }

    const brainFailureStreak = brainFailed ? this.incrementBrainFailureStreak() : this.resetBrainFailureStreak();
    if (brainFailureStreak >= this.config.autonomy.maxBrainFailuresBeforeStop) {
      this.db.insertRuntimeIncident({
        code: "BRAIN_REQUEST_FAILED",
        severity: "critical",
        category: "brain",
        message: `Brain failure streak threshold reached (${brainFailureStreak}/${this.config.autonomy.maxBrainFailuresBeforeStop}).`,
      });
      throw new Error("Brain failure threshold reached; daemon entering fail-safe stop.");
    }

    const executableActions = validation.malformed
      ? [{ type: "noop", reason: "malformed_output" } as BrainAction]
      : validated.nextActions;

    const actionLog: string[] = [];
    let actionFailures = 0;
    for (const action of executableActions) {
      try {
        const result = await this.executeBrainAction(action);
        actionLog.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        actionFailures += 1;
        const code = this.actionFailureCode(action.type, message);
        this.db.insertRuntimeIncident({
          code,
          severity: "warning",
          category: "action",
          message,
          metadata: {
            actionType: action.type,
          },
        });
        actionLog.push(`action ${action.type} failed: ${message}`);
      }
    }

    if (!validation.malformed && validated.memoryWrites?.facts?.length) {
      for (const fact of validated.memoryWrites.facts) {
        this.db.upsertMemoryFact(fact);
      }
    }

    if (!validation.malformed && validated.memoryWrites?.episodes?.length) {
      for (const episode of validated.memoryWrites.episodes) {
        this.db.insertMemoryEpisode(episode);
      }
    }

    this.db.insertMemoryEpisode({
      summary: validated.summary,
      actionType: actionLog.length ? "autonomy_turn" : "autonomy_idle",
      metadata: {
        inboundMessages: inboxMessages.length,
        actions: actionLog,
      },
    });

    const nextSleepMs = validated.sleepMs ?? this.config.autonomy.defaultIntervalMs;
    this.db.setKV("autonomy_next_sleep_ms", String(nextSleepMs));
    output = `Autonomy turn complete. Summary: ${validated.summary}. Actions: ${actionLog.length}. Inbound: ${inboxMessages.length}.`;

    const turnId = this.db.insertTurn({
      state: "running",
      input: input.prompt,
      output,
      metadata: {
        dryRun: false,
        inboundMessageCount: inboxMessages.length,
        actionCount: actionLog.length,
        actionFailureCount: actionFailures,
        actions: actionLog,
        summary: validated.summary,
        queueDepth: queueDepthAtStart,
        brainDurationMs,
        brainMalformed: validation.malformed,
        brainFailureStreak,
        skills: skills.map((skill) => ({ id: skill.id, enabled: skill.enabled })),
      },
    });

    this.db.insertTurnTelemetry({
      turnId,
      survivalTier,
      estimatedUsd,
      queueDepth: queueDepthAtStart,
      spendProxyUsd: estimatedUsd,
      actionsTotal: executableActions.length,
      actionFailures,
      brainDurationMs,
      brainFailures: brainFailureStreak,
      metadata: {
        inboundMessageCount: inboxMessages.length,
        summary: validated.summary,
      },
    });

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "run_tick",
      details: `messages=${inboxMessages.length} actions=${actionLog.length} actionFailures=${actionFailures}`,
    });

    await this.evaluateAndRouteAlerts({
      survivalTier,
      queueDepth: queueDepthAtStart,
      brainFailureStreak,
      actionFailures,
    });

    this.db.setAgentState("sleeping");
    return output;
  }

  async sendMessage(input: {
    to: string;
    content: string;
    threadId?: string;
  }): Promise<{ id: string }> {
    this.ensureInitialized();
    this.assertMutableOperationAllowed("messaging send");
    if (!this.messaging) {
      throw new Error("Messaging transport is not configured");
    }

    const result = await this.messaging.send({
      to: input.to,
      content: input.content,
      threadId: input.threadId,
    });
    const sentAt = new Date().toISOString();

    this.db.insertMessage({
      id: result.id,
      sender: this.getAddress(),
      receiver: input.to,
      content: input.content,
      threadId: input.threadId ?? `dm:${input.to}`,
      receivedAt: sentAt,
    });
    this.db.insertXmtpMessage({
      id: result.id,
      conversationId: input.threadId ?? `dm:${input.to}`,
      senderInboxId: this.getAddress(),
      content: input.content,
      sentAt,
      metadata: { direction: "outbound" },
    });
    this.db.upsertXmtpConversation({
      id: input.threadId ?? `dm:${input.to}`,
      peerInboxId: input.to,
      type: "dm",
      consentState: "allowed",
      updatedAt: sentAt,
    });

    return result;
  }

  async pollMessageInbox(input: {
    since?: string;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    conversationId: string;
    senderInboxId: string;
    content: string;
    sentAt: string;
    metadata: Record<string, unknown>;
  }>> {
    this.ensureInitialized();
    await this.syncMessagingInbox(input.since, input.limit ?? 50);
    return this.db.listXmtpMessages({
      since: input.since,
      limit: input.limit ?? 50,
    });
  }

  async listMessageThreads(limit = 100): Promise<Array<{ id: string; peer?: string; updatedAt?: string }>> {
    this.ensureInitialized();
    const dbThreads = this.db.listXmtpConversations(limit).map((item) => ({
      id: item.id,
      peer: item.peerInboxId,
      updatedAt: item.updatedAt,
    }));

    if (this.messaging?.listThreads) {
      const threads = await this.messaging.listThreads(limit);
      for (const thread of threads) {
        this.db.upsertXmtpConversation({
          id: thread.id,
          peerInboxId: thread.peer,
          type: "dm",
          consentState: "allowed",
          updatedAt: thread.updatedAt ?? new Date().toISOString(),
        });
      }
      const merged = new Map<string, { id: string; peer?: string; updatedAt?: string }>();
      for (const thread of dbThreads) {
        merged.set(thread.id, thread);
      }
      for (const thread of threads) {
        merged.set(thread.id, {
          id: thread.id,
          peer: thread.peer ?? merged.get(thread.id)?.peer,
          updatedAt: thread.updatedAt ?? merged.get(thread.id)?.updatedAt,
        });
      }
      return Array.from(merged.values())
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        .slice(0, limit);
    }

    return dbThreads;
  }

  listSkills(): SkillRecord[] {
    this.ensureInitialized();
    return loadSkillRecords(this.config, this.getEnabledSkillIds());
  }

  listToolSources(): ToolSourceConfig[] {
    this.ensureInitialized();
    return this.toolRegistry.listSources();
  }

  async invokeTool(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
    this.ensureInitialized();
    return this.toolRegistry.invoke(request);
  }

  setSkillEnabled(skillId: string, enabled: boolean): { id: string; enabled: boolean } {
    this.ensureInitialized();
    const current = this.getEnabledSkillIds();
    const set = new Set(current);
    if (enabled) {
      set.add(skillId);
    } else {
      set.delete(skillId);
    }
    this.db.setJsonKV("enabled_skill_ids", Array.from(set));
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "skill_toggle",
      details: `${skillId}:${enabled ? "enabled" : "disabled"}`,
    });
    return { id: skillId, enabled };
  }

  listMemoryFacts(limit = 200) {
    this.ensureInitialized();
    return this.db.listMemoryFacts(limit);
  }

  listMemoryEpisodes(limit = 200) {
    this.ensureInitialized();
    return this.db.listMemoryEpisodes(limit);
  }

  getChild(identifier: string): ChildRecord | null {
    this.ensureInitialized();
    return this.db.getChild(identifier);
  }

  updateChildStatusByIdentifier(identifier: string, status: ChildStatus): ChildRecord {
    this.ensureInitialized();
    const child = this.db.getChild(identifier);
    if (!child) {
      throw new Error(`Child not found: ${identifier}`);
    }

    this.db.updateChildStatusByIdentifier(identifier, status);
    return { ...child, status };
  }

  resumeChild(identifier: string): ChildRecord {
    this.assertMutableOperationAllowed("child resume");
    return this.updateChildStatusByIdentifier(identifier, "running");
  }

  async terminateChild(identifier: string, destroySandbox = true): Promise<ChildRecord> {
    this.ensureInitialized();
    const child = this.db.getChild(identifier);
    if (!child) {
      throw new Error(`Child not found: ${identifier}`);
    }

    if (child.status === "deleted") {
      return child;
    }

    if (destroySandbox && child.sandboxId) {
      if (!this.provider) {
        throw new Error("Provider required to destroy child sandbox");
      }
      await this.provider.destroySandbox(child.sandboxId);
    }

    this.db.updateChildStatusByIdentifier(identifier, "deleted");

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "replication",
      action: "terminate_child",
      details: `child=${identifier} sandbox=${child.sandboxId ?? "none"} destroy=${destroySandbox}`,
    });

    return { ...child, status: "deleted" };
  }

  status(): AgentStatus {
    this.ensureInitialized();

    const emergency = this.db.getEmergencyState();
    const startedAt = this.db.getKV("started_at") ?? undefined;
    const recentTurns = this.db.getRecentTurns(1);
    const childCount = this.db.countChildren();
    const survival = this.db.getLatestSurvivalSnapshot();

    return {
      name: this.config.name,
      address: this.getAddress() as AgentStatus["address"],
      state: this.db.getAgentState(),
      survivalTier: survival?.tier,
      estimatedUsd: survival?.estimatedUsd,
      chain: this.config.chainDefault,
      emergencyStop: emergency.enabled,
      emergencyReason: emergency.reason,
      childCount,
      lastTurnAt: recentTurns[0]?.timestamp,
      startedAt,
    };
  }

  emergencyStop(reason: string): void {
    this.ensureInitialized();
    this.daemonRunning = false;
    this.db.setEmergencyStop(true, reason);
    this.db.setAgentState("stopped");
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "emergency_stop",
      details: reason,
    });
  }

  clearEmergencyStop(): void {
    this.ensureInitialized();
    this.db.setEmergencyStop(false);
    this.db.setAgentState("sleeping");
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "emergency_stop_cleared",
    });
  }

  selfModify(targetPath: string, content: string): void {
    this.ensureInitialized();
    this.assertMutableOperationAllowed("self-modification");

    if (!this.config.aggressiveSelfMod) {
      throw new Error("Self-modification is disabled in config");
    }

    if (!this.canPerformSelfMod()) {
      throw new Error(
        `Self-modification denied: ${SELF_MOD_LIMIT_PER_WINDOW} writes/hour limit exceeded`,
      );
    }

    if (isProtectedPath(targetPath, this.config.constitutionPolicy)) {
      throw new Error(`Self-modification denied for protected path: ${targetPath}`);
    }

    const resolvedTargetPath = path.resolve(targetPath);
    if (!this.isSelfModPathAllowed(resolvedTargetPath)) {
      throw new Error(
        `Self-modification denied for out-of-scope path: ${resolvedTargetPath}`,
      );
    }

    const beforeHash = fs.existsSync(resolvedTargetPath) ? hashFileSafe(resolvedTargetPath) : null;
    fs.mkdirSync(path.dirname(resolvedTargetPath), { recursive: true, mode: 0o700 });
    const backupPath = this.captureRollbackBackup(resolvedTargetPath);
    fs.writeFileSync(resolvedTargetPath, content, { mode: 0o600 });
    const afterHash = hashFileSafe(resolvedTargetPath);
    this.recordSelfModAttempt();

    const mutationId = this.db.insertSelfModMutation({
      path: resolvedTargetPath,
      beforeHash,
      afterHash,
      createdAt: new Date().toISOString(),
      reason: "runtime self-modification",
    });
    this.db.insertRollbackPoint({
      mutationId,
      path: resolvedTargetPath,
      rollbackHash: beforeHash ?? afterHash,
      createdAt: new Date().toISOString(),
    });
    if (backupPath) {
      this.db.setKV(`${SELF_MOD_BACKUP_KEY_PREFIX}${mutationId}`, backupPath);
    } else {
      this.db.setKV(`${SELF_MOD_BACKUP_KEY_PREFIX}${mutationId}`, "__DELETE__");
    }

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "self_mod",
      action: "write_file",
      details: resolvedTargetPath,
    });
  }

  async replicate(plan: ReplicationPlan): Promise<{ childId: string; sandboxId: string }> {
    this.ensureInitialized();
    this.assertMutableOperationAllowed("replication");

    if (!this.provider) {
      throw new Error("No compute provider configured for replication");
    }

    const activeChildren = this.db.countChildren("running");
    if (activeChildren >= this.config.maxChildren) {
      throw new Error(`Maximum child count reached: ${this.config.maxChildren}`);
    }

    const sandbox = await this.provider.createSandbox({
      name: `aethernet-child-${plan.name.toLowerCase().replace(/\s+/g, "-")}`,
      vcpu: 1,
      memoryMb: 512,
      diskGb: 5,
    });

    const childPrivateKey = generatePrivateKey();
    const childAccount = privateKeyToAccount(childPrivateKey);

    const childId = this.db.insertChild({
      name: plan.name,
      address: childAccount.address,
      sandboxId: sandbox.id,
      status: "running",
      genesisPrompt: plan.genesisPrompt,
      metadata: {
        funding: plan.initialFundingUsdc,
        creatorAddress: plan.creatorAddress,
        metadata: plan.metadata,
        parentAddress: plan.parentAddress,
        childAddress: childAccount.address,
      },
    });

    await this.provider.writeFile({
      sandboxId: sandbox.id,
      path: "/root/.aethernet/genesis.json",
      content: JSON.stringify(
        {
          ...plan,
          childAddress: childAccount.address,
        },
        null,
        2,
      ),
    });

    await this.provider.writeFile({
      sandboxId: sandbox.id,
      path: "/root/.aethernet/wallet.private.json",
      content: JSON.stringify(
        {
          address: childAccount.address,
          privateKey: childPrivateKey,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    });

    if (Number(plan.initialFundingUsdc) > 0) {
      const chain = this.config.chainProfiles.find((profile) => profile.caip2 === this.config.chainDefault);
      if (chain?.supports?.payments === false) {
        throw new Error(`Replication funding unavailable on ${chain.caip2}: payments unsupported`);
      }
      await this.provider.fundWallet({
        sandboxId: sandbox.id,
        toAddress: childAccount.address,
        amount: plan.initialFundingUsdc,
        asset: "USDC",
        network: this.config.chainDefault,
      });
    }

    this.db.insertLineageEdge({
      parentChildId: this.db.getKV("self_child_id") ?? "root",
      childChildId: childId,
      parentAddress: plan.parentAddress,
      childAddress: childAccount.address,
      reason: "spawn",
    });

    this.db.upsertXmtpConversation({
      id: `lineage:${childId}`,
      peerInboxId: childAccount.address,
      type: "dm",
      consentState: "allowed",
      updatedAt: new Date().toISOString(),
    });

    if (this.messaging) {
      try {
        await this.sendMessage({
          to: childAccount.address,
          threadId: `lineage:${childId}`,
          content: JSON.stringify(
            {
              type: "lineage_init",
              childId,
              genesisPrompt: plan.genesisPrompt,
              parent: plan.parentAddress,
            },
            null,
            2,
          ),
        });
      } catch (error) {
        this.db.insertRuntimeIncident({
          code: "ACTION_FAILED",
          severity: "warning",
          category: "replication",
          message: `Failed to deliver parent-child XMTP bootstrap message: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "replication",
      action: "spawn_child",
      details: `child=${childId} name=${plan.name} sandbox=${sandbox.id} childAddress=${childAccount.address}`,
    });

    return { childId, sandboxId: sandbox.id };
  }

  close(): void {
    this.daemonRunning = false;
    this.db.close();
  }

  async runDaemon(input: {
    intervalMs?: number;
    onTick?: (output: string) => void;
  } = {}): Promise<void> {
    this.ensureInitialized();
    const intervalMs = input.intervalMs ?? this.config.autonomy.defaultIntervalMs ?? this.config.heartbeatIntervalMs;
    let consecutiveErrors = 0;
    this.daemonRunning = true;
    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "daemon_started",
      details: `intervalMs=${intervalMs}`,
    });

    while (this.daemonRunning) {
      const heartbeatId = this.db.insertHeartbeatRun({
        taskName: "runtime_tick",
        status: "started",
      });

      try {
        const output = await this.run();
        consecutiveErrors = 0;
        this.db.updateHeartbeatRun(heartbeatId, "completed", output);
        input.onTick?.(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        consecutiveErrors += 1;
        this.db.updateHeartbeatRun(heartbeatId, "failed", message);
        const deadState = message.includes("survival tier is dead");
        this.db.insertRuntimeIncident({
          code: deadState ? "DAEMON_FAILURE" : "DAEMON_FAILURE",
          severity: deadState ? "critical" : "warning",
          category: "daemon",
          message: `${message} (consecutiveErrors=${consecutiveErrors})`,
        });
        if (deadState || consecutiveErrors >= this.config.autonomy.maxConsecutiveErrors) {
          this.daemonRunning = false;
          this.db.setAgentState(deadState ? "dead" : "stopped");
        }
      }

      const requestedSleep = Number(this.db.getKV("autonomy_next_sleep_ms") ?? intervalMs);
      const nextSleep = Number.isFinite(requestedSleep) && requestedSleep > 0
        ? Math.min(Math.floor(requestedSleep), this.config.autonomy.maxSleepMs)
        : intervalMs;
      await sleep(nextSleep);
    }

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "daemon_stopped",
    });
  }

  stopDaemon(): void {
    this.daemonRunning = false;
  }

  rollbackSelfMod(pathValue: string): void {
    this.ensureInitialized();
    this.assertMutableOperationAllowed("self-mod rollback");
    const rollback = this.db
      .listRollbackPoints(200)
      .find((point) => point.path === path.resolve(pathValue));
    if (!rollback) {
      throw new Error(`No rollback point found for path: ${pathValue}`);
    }

    const key = `${SELF_MOD_BACKUP_KEY_PREFIX}${rollback.mutationId}`;
    const backupPath = this.db.getKV(key);
    const targetPath = rollback.path;
    if (backupPath === "__DELETE__") {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath);
      }
    } else if (backupPath && fs.existsSync(backupPath)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(backupPath, targetPath);
    } else {
      throw new Error(`Rollback data missing for mutation ${rollback.mutationId}`);
    }

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "self_mod",
      action: "rollback_applied",
      details: `path=${targetPath} mutation=${rollback.mutationId}`,
    });
  }

  private async executeBrainAction(action: BrainAction): Promise<string> {
    this.assertActionAllowlisted(action.type);
    const params = action.params ?? {};

    if (action.type === "send_message") {
      this.assertActionChainCapability({}, "messaging", "send_message");
      if (!this.isWalletUnlocked()) {
        throw new Error("Wallet is locked. Unlock before autonomous send_message actions.");
      }
      const to = typeof params.to === "string" ? params.to : "";
      const content = typeof params.content === "string" ? params.content : "";
      const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
      if (!to || !content) {
        throw new Error("send_message requires string params.to and params.content");
      }
      const result = await this.sendMessage({ to, content, threadId });
      return `send_message:${result.id}`;
    }

    if (action.type === "replicate") {
      const initialFundingUsdc =
        typeof params.initialFundingUsdc === "string" ? params.initialFundingUsdc : "0";
      if (Number(initialFundingUsdc) > 0) {
        this.assertActionChainCapability({}, "payments", "replicate");
      } else {
        this.assertActionChainSupported({}, "replicate");
      }
      if (!this.isWalletUnlocked()) {
        throw new Error("Wallet is locked. Unlock before autonomous replication.");
      }
      const name = typeof params.name === "string" ? params.name : "aethernet-child";
      const genesisPrompt =
        typeof params.genesisPrompt === "string"
          ? params.genesisPrompt
          : "You are a sovereign child runtime. Operate under immutable laws and earn your existence.";
      const result = await this.replicate({
        name,
        genesisPrompt,
        creatorAddress: this.config.creatorAddress,
        parentAddress: this.getAddress() as `0x${string}`,
        initialFundingUsdc,
      });
      return `replicate:${result.sandboxId}`;
    }

    if (action.type === "self_modify") {
      if (!this.config.autonomy.allowSelfModifyAction) {
        throw new Error("self_modify action is disabled by autonomy policy.");
      }
      const targetPath = typeof params.targetPath === "string" ? params.targetPath : "";
      const content = typeof params.content === "string" ? params.content : "";
      if (!targetPath || !content) {
        throw new Error("self_modify requires string params.targetPath and params.content");
      }
      this.selfModify(targetPath, content);
      return `self_modify:${targetPath}`;
    }

    if (action.type === "record_fact") {
      const key = typeof params.key === "string" ? params.key : "";
      const value = typeof params.value === "string" ? params.value : "";
      if (!key || !value) {
        throw new Error("record_fact requires string params.key and params.value");
      }
      this.db.upsertMemoryFact({
        key,
        value,
        confidence: Number.isFinite(Number(params.confidence))
          ? Number(params.confidence)
          : undefined,
        source: typeof params.source === "string" ? params.source : "brain_action",
      });
      return `record_fact:${key}`;
    }

    if (action.type === "record_episode") {
      const summary = typeof params.summary === "string" ? params.summary : "";
      if (!summary) {
        throw new Error("record_episode requires string params.summary");
      }
      this.db.insertMemoryEpisode({
        summary,
        outcome: typeof params.outcome === "string" ? params.outcome : undefined,
        actionType: typeof params.actionType === "string" ? params.actionType : "brain_action",
      });
      return "record_episode";
    }

    if (action.type === "invoke_tool") {
      const sourceId = typeof params.sourceId === "string" ? params.sourceId : "";
      const toolName = typeof params.toolName === "string" ? params.toolName : "";
      const toolInput = isRecord(params.input) ? params.input : {};
      if (!sourceId || !toolName) {
        throw new Error("invoke_tool requires string params.sourceId and params.toolName");
      }
      const result = await this.invokeTool({
        sourceId,
        toolName,
        input: toolInput,
      });
      if (!result.ok) {
        throw new Error(`invoke_tool failed for ${sourceId}/${toolName}: ${result.error ?? "unknown error"}`);
      }
      return `invoke_tool:${sourceId}/${toolName}`;
    }

    if (action.type === "sleep") {
      const requested = Number(params.sleepMs ?? params.durationMs);
      if (Number.isFinite(requested) && requested > 0) {
        const bounded = Math.min(requested, this.config.autonomy.maxSleepMs);
        this.db.setKV("autonomy_next_sleep_ms", String(Math.floor(bounded)));
        return `sleep:${Math.floor(bounded)}`;
      }
      return "sleep:default";
    }

    if (action.type === "noop") {
      return `noop:${action.reason ?? "none"}`;
    }

    throw new Error(`Unsupported action type: ${action.type}`);
  }

  private async applyInboundCommand(command: InboundRuntimeCommand | null): Promise<string | null> {
    if (!command || command.type === "noop") {
      return null;
    }

    if (command.type === "self_mod") {
      if (!command.targetPath || command.content === undefined) {
        return "ignore self_mod command missing targetPath/content";
      }

      this.selfModify(command.targetPath, command.content);
      return `self-mod applied: ${command.targetPath}`;
    }

    if (command.type === "replicate") {
      const plan: ReplicationPlan = {
        name: command.plan?.name ?? "aethernet-child",
        genesisPrompt:
          command.plan?.genesisPrompt ??
          "You are a sovereign child runtime. Operate under immutable laws and earn your existence.",
        creatorAddress: this.getAddress() as `0x${string}`,
        parentAddress: this.getAddress() as `0x${string}`,
        initialFundingUsdc: command.plan?.initialFundingUsdc ?? "0",
        metadata: command.plan?.metadata,
      };

      const result = await this.replicate(plan);
      return `replication spawned: ${result.sandboxId}`;
    }

    return null;
  }

  private assertMutableOperationAllowed(operation: string): void {
    const emergency = this.db.getEmergencyState();
    if (emergency.enabled) {
      throw new Error(`Cannot perform ${operation} while emergency stop is active`);
    }

    const latestSurvival = this.db.getLatestSurvivalSnapshot();
    if (latestSurvival?.tier === "dead") {
      throw new Error(`Cannot perform ${operation} while runtime is in dead tier`);
    }
  }

  private buildToolSources(configured: ToolSourceConfig[]): ToolSourceConfig[] {
    const base: ToolSourceConfig[] = [
      {
        id: "internal.runtime",
        name: "Runtime Internal",
        type: "internal",
        enabled: true,
        metadata: {
          adapter: "internal",
          mode: "read-only",
        },
      },
    ];

    const byId = new Map<string, ToolSourceConfig>();
    for (const source of [...base, ...configured]) {
      byId.set(source.id, source);
    }
    return Array.from(byId.values());
  }

  private internalToolHandlers(): Record<string, (request: ToolInvocationRequest) => Promise<ToolInvocationResult> | ToolInvocationResult> {
    return {
      "agent.status": async () => ({
        ok: true,
        output: this.status(),
      }),
      "memory.facts": async (request) => ({
        ok: true,
        output: this.listMemoryFacts(toNumber(request.input.limit, 50)),
      }),
      "memory.episodes": async (request) => ({
        ok: true,
        output: this.listMemoryEpisodes(toNumber(request.input.limit, 50)),
      }),
      "messages.threads": async (request) => ({
        ok: true,
        output: await this.listMessageThreads(toNumber(request.input.limit, 20)),
      }),
      "survival.latest": async () => ({
        ok: true,
        output: this.db.getLatestSurvivalSnapshot(),
      }),
      "queue.depth": async () => ({
        ok: true,
        output: {
          queuedMessages: this.db.countMessages(),
        },
      }),
    };
  }

  private assertActionAllowlisted(actionType: BrainAction["type"]): void {
    if (!this.config.autonomy.strictActionAllowlist) {
      return;
    }
    if (ALLOWED_AUTONOMY_ACTIONS.has(actionType)) {
      return;
    }
    throw new Error(`Action ${actionType} is not in the autonomy allowlist.`);
  }

  private assertActionChainSupported(params: Record<string, unknown>, actionType: string): void {
    this.resolveActionChain(params, actionType);
  }

  private assertActionChainCapability(
    params: Record<string, unknown>,
    capability: "identity" | "reputation" | "payments" | "auth" | "messaging",
    actionType: string,
  ): void {
    const chain = this.resolveActionChain(params, actionType);
    if (chain.supports?.[capability] === false) {
      throw new Error(`Chain capability blocked for ${actionType}: ${chain.caip2} does not support ${capability}.`);
    }
  }

  private resolveActionChain(
    params: Record<string, unknown>,
    actionType: string,
  ) {
    const requested = params.chain ?? params.network ?? params.caip2 ?? this.config.chainDefault;
    const chainKey = typeof requested === "string" ? requested : String(requested);
    const chain = this.config.chainProfiles.find((profile) => (
      profile.caip2 === chainKey
      || String(profile.chainId) === chainKey
      || profile.name.toLowerCase() === chainKey.toLowerCase()
    ));
    if (!chain) {
      throw new Error(`Action ${actionType} requested unsupported chain: ${chainKey}.`);
    }
    return chain;
  }

  private actionFailureCode(actionType: BrainAction["type"], message: string): RuntimeIncidentCode {
    if (message.includes("Wallet is locked")) {
      return "WALLET_LOCKED";
    }
    if (message.includes("unsupported chain") || message.includes("does not support")) {
      return "CHAIN_CAPABILITY_BLOCKED";
    }
    if (message.includes("allowlist") || message.includes("disabled by autonomy policy")) {
      return "ACTION_BLOCKED";
    }
    if (actionType === "self_modify" && message.includes("denied")) {
      return "SECURITY_POLICY_VIOLATION";
    }
    return "ACTION_FAILED";
  }

  private incrementBrainFailureStreak(): number {
    const current = Number(this.db.getKV(BRAIN_FAILURE_STREAK_KEY) ?? "0");
    const next = Number.isFinite(current) ? current + 1 : 1;
    this.db.setKV(BRAIN_FAILURE_STREAK_KEY, String(next));
    return next;
  }

  private resetBrainFailureStreak(): number {
    this.db.setKV(BRAIN_FAILURE_STREAK_KEY, "0");
    return 0;
  }

  private async evaluateAndRouteAlerts(input: {
    survivalTier: SurvivalTier;
    queueDepth: number;
    brainFailureStreak: number;
    actionFailures: number;
  }): Promise<void> {
    if (!this.config.alerting.enabled) {
      return;
    }

    const windowStart = Date.now() - (this.config.alerting.evaluationWindowMinutes * 60_000);
    const incidents = this.db
      .listRuntimeIncidents(500)
      .filter((incident) => Date.parse(incident.timestamp) >= windowStart);
    const criticalCount = incidents.filter((incident) => incident.severity === "critical").length;

    const alertCandidates: Array<{
      code: RuntimeIncidentCode;
      severity: "warning" | "critical";
      message: string;
      metadata: Record<string, unknown>;
    }> = [];

    if (input.survivalTier === "dead") {
      alertCandidates.push({
        code: "ALERT_TRIGGERED",
        severity: "critical",
        message: "Survival tier reached dead state.",
        metadata: { survivalTier: input.survivalTier },
      });
    }

    if (criticalCount >= this.config.alerting.criticalIncidentThreshold) {
      alertCandidates.push({
        code: "ALERT_TRIGGERED",
        severity: "critical",
        message: `Critical incident threshold exceeded (${criticalCount}/${this.config.alerting.criticalIncidentThreshold}).`,
        metadata: { criticalCount, evaluationWindowMinutes: this.config.alerting.evaluationWindowMinutes },
      });
    }

    if (input.brainFailureStreak >= this.config.alerting.brainFailureThreshold) {
      alertCandidates.push({
        code: "ALERT_TRIGGERED",
        severity: "critical",
        message: `Brain failure streak threshold exceeded (${input.brainFailureStreak}/${this.config.alerting.brainFailureThreshold}).`,
        metadata: { brainFailureStreak: input.brainFailureStreak },
      });
    }

    if (input.queueDepth >= this.config.alerting.queueDepthThreshold) {
      alertCandidates.push({
        code: "ALERT_TRIGGERED",
        severity: "warning",
        message: `Queue depth threshold exceeded (${input.queueDepth}/${this.config.alerting.queueDepthThreshold}).`,
        metadata: { queueDepth: input.queueDepth, actionFailures: input.actionFailures },
      });
    }

    for (const candidate of alertCandidates) {
      const markerKey = `alert:last:${candidate.severity}:${candidate.message}`;
      const last = Number(this.db.getKV(markerKey) ?? "0");
      if (Number.isFinite(last) && Date.now() - last < 60_000) {
        continue;
      }
      this.db.setKV(markerKey, String(Date.now()));
      this.db.insertAlertEvent({
        code: candidate.code,
        severity: candidate.severity,
        route: this.config.alerting.route,
        message: candidate.message,
        metadata: candidate.metadata,
      });
      this.db.insertRuntimeIncident({
        code: candidate.code,
        severity: candidate.severity,
        category: "alert",
        message: candidate.message,
        metadata: candidate.metadata,
      });

      if (this.config.alerting.route === "stdout") {
        const line = `[ALERT][${candidate.severity}] ${candidate.message}`;
        if (candidate.severity === "critical") {
          console.error(line);
        } else {
          console.warn(line);
        }
      } else if (this.config.alerting.route === "webhook" && this.config.alerting.webhookUrl) {
        try {
          await fetch(this.config.alerting.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: candidate.code,
              severity: candidate.severity,
              message: candidate.message,
              metadata: candidate.metadata,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (error) {
          this.db.insertRuntimeIncident({
            code: "PROVIDER_FAILURE",
            severity: "warning",
            category: "alert",
            message: `Alert webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }

  private isSelfModPathAllowed(targetPath: string): boolean {
    const normalized = path.resolve(targetPath);
    const allowedRoots = [path.resolve(process.cwd()), path.resolve(this.config.homeDir)];
    return allowedRoots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`));
  }

  private captureRollbackBackup(targetPath: string): string | null {
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    const rollbacksDir = path.join(this.config.dataDir, "rollbacks");
    fs.mkdirSync(rollbacksDir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(
      rollbacksDir,
      `${path.basename(targetPath).replace(/[^a-zA-Z0-9._-]/g, "_")}.${Date.now()}.bak`,
    );
    fs.copyFileSync(targetPath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    return backupPath;
  }

  private canPerformSelfMod(): boolean {
    const now = Date.now();
    const windowStart = now - SELF_MOD_WINDOW_MS;
    const timestamps = this.getSelfModTimestamps().filter((value) => value >= windowStart);
    return timestamps.length < SELF_MOD_LIMIT_PER_WINDOW;
  }

  private recordSelfModAttempt(): void {
    const now = Date.now();
    const windowStart = now - SELF_MOD_WINDOW_MS;
    const next = this.getSelfModTimestamps()
      .filter((value) => value >= windowStart)
      .concat([now]);
    this.db.setJsonKV(SELF_MOD_RATE_TTL_KEY, next);
  }

  private getSelfModTimestamps(): number[] {
    const value = this.db.getJsonKV<number[]>(SELF_MOD_RATE_TTL_KEY);
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry) => Number.isFinite(entry));
  }

  private getEnabledSkillIds(): string[] {
    const value = this.db.getJsonKV<string[]>("enabled_skill_ids");
    if (!Array.isArray(value) || value.length === 0) {
      return this.config.enabledSkillIds;
    }
    return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  private evaluateSurvivalTier(): SurvivalTier {
    const estimatedUsd = this.estimateLiquidityUsd();
    const thresholds = this.config.survival;

    let tier: SurvivalTier = "normal";
    if (estimatedUsd <= thresholds.deadUsd) {
      tier = "dead";
    } else if (estimatedUsd <= thresholds.criticalUsd) {
      tier = "critical";
    } else if (estimatedUsd <= thresholds.lowComputeUsd) {
      tier = "low_compute";
    }

    this.db.insertSurvivalSnapshot({
      tier,
      estimatedUsd,
      reason: "wallet_liquidity_estimate",
      timestamp: new Date().toISOString(),
    });

    return tier;
  }

  private estimateLiquidityUsd(): number {
    const configured = Number(process.env.AETHERNET_ESTIMATED_USD_BALANCE ?? "100");
    if (!Number.isFinite(configured) || configured < 0) {
      return 0;
    }
    return configured;
  }

  private async syncMessagingInbox(since?: string, limit = 50): Promise<void> {
    if (!this.messaging) {
      return;
    }

    const lastIso = since ?? this.db.getKV("xmtp_last_poll_at") ?? undefined;
    const messages = await this.messaging.poll({
      since: lastIso,
      limit,
    });

    for (const message of messages) {
      this.db.insertXmtpMessage({
        id: message.id,
        conversationId: message.threadId ?? "default",
        senderInboxId: message.from,
        content: message.content,
        sentAt: message.receivedAt,
        metadata: {
          to: message.to,
        },
      });
      this.db.insertMessage({
        id: message.id,
        sender: message.from,
        receiver: message.to,
        content: message.content,
        threadId: message.threadId,
        receivedAt: message.receivedAt,
      });
      this.db.upsertXmtpConversation({
        id: message.threadId ?? `dm:${message.from}`,
        peerInboxId: message.from,
        type: "dm",
        consentState: "allowed",
        updatedAt: message.receivedAt,
      });
    }

    this.db.setKV("xmtp_last_poll_at", new Date().toISOString());
  }
}

function hashFileSafe(targetPath: string): string {
  const content = fs.readFileSync(targetPath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function parseInboundCommand(input: string): InboundRuntimeCommand | null {
  try {
    const parsed = JSON.parse(input) as Partial<InboundRuntimeCommand> & {
      action?: string;
      target?: string;
      payload?: InboundRuntimeCommand["plan"];
    };

    if (parsed.type === "self_mod" || parsed.action === "self_mod" || parsed.action === "self-mod") {
      return {
        type: "self_mod",
        targetPath: parsed.targetPath ?? parsed.target,
        content: parsed.content ?? JSON.stringify(parsed.payload),
      };
    }

    if (parsed.type === "replicate" || parsed.action === "replicate") {
      return {
        type: "replicate",
        plan: parsed.plan ?? parsed.payload,
      };
    }

    if (parsed.type === "noop") {
      return { type: "noop" };
    }
  } catch {
    return null;
  }

  return null;
}
