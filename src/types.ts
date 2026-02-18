/**
 * Core types for the Aethernet agent runtime
 */

export interface AgentConfig {
  name: string;
  walletPrivateKey?: string;
  rpcUrl: string;
  registryContractAddress?: string;
  xmtpEnv?: 'dev' | 'production' | 'local';
  minJobPayment?: bigint;
  capabilities?: string[];
}

export interface AgentIdentity {
  address: string;
  publicKey: string;
  agentId?: string;
}

export interface Job {
  id: string;
  sender: string;
  description: string;
  payment: bigint;
  status: 'pending' | 'accepted' | 'running' | 'completed' | 'failed';
  timestamp: number;
  result?: string;
}

export interface AgentCapability {
  name: string;
  description: string;
  handler: (params: any) => Promise<any>;
  requiredPermissions?: string[];
}

export interface RevenueRecord {
  timestamp: number;
  amount: bigint;
  source: string;
  jobId: string;
}

export interface ReputationScore {
  jobsCompleted: number;
  jobsFailed: number;
  totalRevenue: bigint;
  averageResponseTime: number;
  score: number;
}

export interface AgentState {
  identity: AgentIdentity;
  isRunning: boolean;
  balance: bigint;
  reputation: ReputationScore;
  activeJobs: Job[];
  revenue: RevenueRecord[];
}
