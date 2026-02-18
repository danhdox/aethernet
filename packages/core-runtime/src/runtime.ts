import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentConfig,
  AgentMessage,
  AgentStatus,
  ComputeProvider,
  MessagingTransport,
  ReplicationPlan,
  SurvivalTier,
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

const SELF_MOD_WINDOW_MS = 60 * 60 * 1000;
const SELF_MOD_LIMIT_PER_WINDOW = 6;
const SELF_MOD_RATE_TTL_KEY = "self_mod_timestamps_v1";
const SELF_MOD_BACKUP_KEY_PREFIX = "self_mod_backup_v1:";

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
}

export class AethernetRuntime {
  readonly config: AgentConfig;
  readonly db: AethernetDatabase;
  private readonly provider?: ComputeProvider;
  private readonly messaging?: MessagingTransport;
  private account?: PrivateKeyAccount;
  private unlockedUntil: number | null = null;
  private daemonRunning = false;
  private initialized = false;

  constructor(config: AgentConfig, dependencies: RuntimeDependencies = {}) {
    this.config = config;
    this.db = dependencies.db ?? new AethernetDatabase({ dbPath: config.dbPath });
    this.provider = dependencies.provider;
    this.messaging = dependencies.messaging;
  }

  initialize(): { address: string; walletCreated: boolean } {
    ensureRuntimeDirectories(this.config);
    ensureLawTemplates(this.config);

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

    let output = "Runtime tick complete.";
    const actionLog: string[] = [];

    if (input.dryRun) {
      output = "Dry run complete: runtime safeguards and loop skeleton executed.";
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
    const inbound = this.db.pollMessages(25);
    for (const message of inbound) {
      const command = parseInboundCommand(message.content);
      try {
        const actionResult = await this.applyInboundCommand(command);
        if (actionResult) {
          actionLog.push(actionResult);
        }
      } catch (error) {
        actionLog.push(
          `message ${message.id} processing failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.db.markMessageProcessed(message.id);
      }
    }

    if (input.prompt?.trim()) {
      actionLog.push(`operator prompt observed`);
    }

    output = `Runtime tick complete. Inbound messages processed: ${inbound.length}. Actions taken: ${actionLog.length}.`;

    this.db.insertTurn({
      state: "running",
      input: input.prompt,
      output,
      metadata: {
        dryRun: false,
        inboundMessageCount: inbound.length,
        actionCount: actionLog.length,
        actions: actionLog,
      },
    });

    this.db.insertAudit({
      timestamp: new Date().toISOString(),
      category: "runtime",
      action: "run_tick",
      details: `messages=${inbound.length} actions=${actionLog.length}`,
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
    const intervalMs = input.intervalMs ?? this.config.heartbeatIntervalMs;
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
        this.db.updateHeartbeatRun(heartbeatId, "completed", output);
        input.onTick?.(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.db.updateHeartbeatRun(heartbeatId, "failed", message);
        const deadState = message.includes("survival tier is dead");
        this.db.insertRuntimeIncident({
          severity: deadState ? "critical" : "warning",
          category: "daemon",
          message,
        });
        if (deadState) {
          this.daemonRunning = false;
          this.db.setAgentState("dead");
        }
      }

      await sleep(intervalMs);
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
