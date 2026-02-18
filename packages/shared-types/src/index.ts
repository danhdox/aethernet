export type HexAddress = `0x${string}`;
export type Caip2Network = `eip155:${number}`;

export interface ChainProfile {
  chainId: number;
  name: string;
  caip2: Caip2Network;
  rpcUrl: string;
  rpcFallbackUrls?: string[];
  identityRegistry: HexAddress;
  reputationRegistry?: HexAddress;
  usdcAddress?: HexAddress;
  supports?: FeatureSupportMatrix;
  isTestnet: boolean;
}

export interface FeatureSupportMatrix {
  identity: boolean;
  reputation: boolean;
  payments: boolean;
  auth: boolean;
  messaging: boolean;
}

export interface AgentRegistryRef {
  chainId: number;
  registryAddress: HexAddress;
  agentId: number;
}

export interface SIWAReceipt {
  token: string;
  address: HexAddress;
  agentId: number;
  chainId: number;
  agentRegistry: string;
  issuedAt: string;
  expiresAt?: string;
}

export interface ERC8128RequestEnvelope {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  signature: string;
  keyId?: string;
  receipt?: string;
}

export interface AuthNonceRecord {
  token: string;
  address: HexAddress;
  agentId: number;
  agentRegistry: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string | null;
}

export interface AuthReplayPolicy {
  nonceHeader: string;
  timestampHeader: string;
  maxSkewMs: number;
  ttlMs: number;
}

export interface X402Requirement {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description?: string;
    payToAddress: HexAddress;
    usdcAddress?: HexAddress;
    asset?: string;
    requiredDeadlineSeconds?: number;
  }>;
  error?: string;
}

export interface X402Settlement {
  x402Version: number;
  success: boolean;
  txHash?: string;
  network: string;
  payer: HexAddress;
  payee: HexAddress;
  amount: string;
  settledAt: string;
  error?: string;
}

export interface XmtpConversationRef {
  id: string;
  peerInboxId?: string;
  type: "dm" | "group";
  consentState?: XmtpConsentState;
  updatedAt: string;
}

export type XmtpConsentState = "unknown" | "allowed" | "denied";

export interface ConstitutionPolicy {
  constitutionPath: string;
  lawsPath: string;
  protectedPaths: string[];
  hashAlgorithm: "sha256";
}

export interface ReplicationPlan {
  name: string;
  genesisPrompt: string;
  creatorAddress: HexAddress;
  parentAddress: HexAddress;
  initialFundingUsdc: string;
  metadata?: Record<string, string>;
}

export interface ChildLineageRecord {
  parentChildId: string;
  childChildId: string;
  parentAddress: HexAddress;
  childAddress?: HexAddress;
  reason?: string;
  createdAt: string;
}

export interface CreateSandboxInput {
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  region?: string;
}

export interface ProvisionedSandbox {
  id: string;
  name: string;
  status: "creating" | "running" | "stopped" | "deleted";
  createdAt: string;
}

export interface SandboxExecInput {
  sandboxId: string;
  command: string;
  timeoutMs?: number;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxWriteFileInput {
  sandboxId: string;
  path: string;
  content: string;
}

export interface WalletFundingInput {
  sandboxId?: string;
  toAddress: HexAddress;
  amount: string;
  asset: string;
  network: Caip2Network;
}

export interface FundingResult {
  txHash: string;
  network: Caip2Network;
  amount: string;
  asset: string;
}

export interface SandboxStatus {
  sandboxId: string;
  status: "creating" | "running" | "stopped" | "deleted";
  updatedAt: string;
}

export interface SandboxLogInput {
  sandboxId: string;
  tail?: number;
}

export interface ComputeProvider {
  readonly name: string;
  createSandbox(input: CreateSandboxInput): Promise<ProvisionedSandbox>;
  exec(input: SandboxExecInput): Promise<SandboxExecResult>;
  writeFile(input: SandboxWriteFileInput): Promise<void>;
  fundWallet(input: WalletFundingInput): Promise<FundingResult>;
  destroySandbox(sandboxId: string): Promise<void>;
  getSandboxStatus(sandboxId: string): Promise<SandboxStatus>;
  getSandboxLogs(input: SandboxLogInput): Promise<string>;
}

export interface ProviderCapabilityMatrix {
  canCreateSandbox: boolean;
  canDestroySandbox: boolean;
  canExec: boolean;
  canWriteFile: boolean;
  canFundWallet: boolean;
  canGetStatus: boolean;
  canGetLogs: boolean;
}

export interface AgentConfig {
  name: string;
  genesisPrompt: string;
  creatorAddress: HexAddress;
  homeDir: string;
  dataDir: string;
  dbPath: string;
  configPath: string;
  chainDefault: Caip2Network;
  chainProfiles: ChainProfile[];
  conwayApiUrl: string;
  conwayApiKey?: string;
  localApiPort: number;
  maxChildren: number;
  aggressiveSelfMod: boolean;
  walletSessionTtlSec: number;
  heartbeatIntervalMs: number;
  survival: {
    lowComputeUsd: number;
    criticalUsd: number;
    deadUsd: number;
  };
  constitutionPolicy: ConstitutionPolicy;
  debug: boolean;
}

export interface WalletKeystoreMeta {
  address: HexAddress;
  path: string;
  encrypted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnlockSession {
  id: string;
  address: HexAddress;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export type SurvivalTier = "normal" | "low_compute" | "critical" | "dead";

export interface SurvivalSnapshot {
  id: string;
  tier: SurvivalTier;
  estimatedUsd: number;
  reason: string;
  timestamp: string;
}

export interface HeartbeatTask {
  id: string;
  name: string;
  scheduleMs: number;
  enabled: boolean;
}

export interface SelfModMutation {
  id: string;
  path: string;
  beforeHash?: string | null;
  afterHash: string;
  createdAt: string;
  reason?: string | null;
}

export interface RollbackPoint {
  id: string;
  mutationId: string;
  path: string;
  rollbackHash: string;
  createdAt: string;
}

export type AgentState =
  | "setup"
  | "waking"
  | "running"
  | "sleeping"
  | "low_compute"
  | "critical"
  | "dead"
  | "stopped";

export interface AgentStatus {
  name: string;
  address: HexAddress;
  state: AgentState;
  survivalTier?: SurvivalTier;
  estimatedUsd?: number;
  chain: Caip2Network;
  emergencyStop: boolean;
  emergencyReason?: string | null;
  childCount?: number;
  lastTurnAt?: string;
  startedAt?: string;
}

export interface AgentRuntimeMetrics {
  generatedAt: string;
  schemaVersion: number;
  turns: number;
  messagesTotal: number;
  queuedMessages: number;
  paymentEvents: {
    total: number;
    inbound: number;
    outbound: number;
  };
  incidents: {
    total: number;
    info: number;
    warning: number;
    error: number;
    critical: number;
  };
  children: {
    total: number;
    creating: number;
    running: number;
    stopped: number;
    deleted: number;
  };
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  category:
    | "config"
    | "wallet"
    | "identity"
    | "auth"
    | "payments"
    | "messaging"
    | "replication"
    | "self_mod"
    | "runtime";
  action: string;
  details?: string;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  threadId?: string;
  receivedAt: string;
}

export interface MessagingTransport {
  name: string;
  send(input: {
    to: string;
    content: string;
    threadId?: string;
  }): Promise<{ id: string }>;
  poll(input?: { since?: string; limit?: number }): Promise<AgentMessage[]>;
  listThreads?(limit?: number): Promise<Array<{ id: string; peer?: string; updatedAt?: string }>>;
}
