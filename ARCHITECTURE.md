# Aethernet Architecture

This document describes the architecture of Aethernet, a wallet-centric autonomous AI agent runtime.

## Overview

Aethernet is designed with a modular, layered architecture that separates concerns and enables easy extension. Each module has a well-defined interface and responsibility.

```
┌─────────────────────────────────────────────────────────┐
│                   Agent Runtime                         │
│              (Orchestration Layer)                      │
│  - Execution Loop                                       │
│  - Job Management                                       │
│  - Capability Registration                              │
│  - Survival Logic                                       │
└─────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌───────────────┐ ┌───────────┐ ┌────────────┐ ┌──────────┐
│   Identity    │ │   Auth    │ │  Payments  │ │Messaging │
│               │ │           │ │            │ │          │
│ - Wallet      │ │ - Signing │ │ - x402     │ │ - XMTP   │
│ - ERC-8004    │ │ - Verify  │ │ - Revenue  │ │ - Jobs   │
│ - Keys        │ │ - Proofs  │ │ - Balance  │ │ - P2P    │
└───────────────┘ └───────────┘ └────────────┘ └──────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  Reputation    │
                  │                │
                  │ - Scoring      │
                  │ - Tracking     │
                  │ - Levels       │
                  └────────────────┘
```

## Modules

### 1. Identity Layer (`src/identity/identity.ts`)

**Purpose**: Manages agent wallet and identity

**Key Features**:
- Generates new wallets or loads from private key
- Extracts public key for identity verification
- Signs messages with private key
- Registers with ERC-8004 agent registry
- Securely manages private keys

**Interface**:
```typescript
class IdentityManager {
  constructor(provider: Provider, privateKey?: string)
  getIdentity(): AgentIdentity
  getWallet(): Wallet
  signMessage(message: string): Promise<string>
  registerWithERC8004(address: string, metadata: object): Promise<string>
  getPrivateKey(): string
  getMnemonic(): string | null
}
```

**Security Considerations**:
- Private keys never leave the module
- Mnemonic phrases only accessible via explicit getter
- All signing operations happen within the module

### 2. Authentication Layer (`src/auth/auth.ts`)

**Purpose**: Handles agent-native signing and verification

**Key Features**:
- Creates authentication tokens via message signing
- Verifies signatures to authenticate agents
- Generates capability proofs for permission control
- Validates capability proofs

**Interface**:
```typescript
class AuthManager {
  constructor(identity: IdentityManager)
  createAuthToken(challenge: string): Promise<string>
  verifyAuthToken(token: string, challenge: string, address: string): Promise<boolean>
  signData(data: any): Promise<string>
  verifySignedData(data: any, signature: string, address: string): Promise<boolean>
  createCapabilityProof(capability: string, nonce: string): Promise<string>
  verifyCapabilityProof(proof: string, capability: string, nonce: string, address: string): Promise<boolean>
}
```

**Use Cases**:
- Agents authenticating with services
- Proving ownership of capabilities
- Signing job results
- Inter-agent trust establishment

### 3. Payment Layer (`src/payments/payments.ts`)

**Purpose**: Manages payments and revenue tracking

**Key Features**:
- Validates x402 payment-gated jobs
- Processes payments for completed jobs
- Tracks revenue history
- Manages agent balance
- Supports withdrawals
- Calculates dynamic pricing

**Interface**:
```typescript
class PaymentManager {
  constructor(wallet: Wallet, minPayment: bigint)
  validateX402Payment(job: Job): Promise<boolean>
  processPayment(job: Job): Promise<void>
  getTotalRevenue(): bigint
  getRevenueHistory(): RevenueRecord[]
  getBalance(): Promise<bigint>
  withdraw(to: string, amount: bigint): Promise<string>
  setMinPayment(amount: bigint): void
  getMinPayment(): bigint
  calculateJobPayment(complexity: 'low' | 'medium' | 'high'): bigint
}
```

**Payment Flow**:
1. Job arrives with payment amount
2. `validateX402Payment()` checks against minimum
3. Job is accepted or rejected
4. Upon completion, `processPayment()` records revenue
5. Revenue is tracked for reputation and survival

### 4. Messaging Layer (`src/messaging/messaging.ts`)

**Purpose**: Handles XMTP peer-to-peer communication

**Key Features**:
- Initializes XMTP client
- Sends messages to addresses
- Listens for incoming messages
- Parses job requests from messages
- Sends job responses
- Manages conversation state

**Interface**:
```typescript
class MessagingManager {
  constructor(wallet: Wallet)
  initialize(env: 'dev' | 'production' | 'local'): Promise<void>
  sendMessage(to: string, content: string): Promise<void>
  startListening(): Promise<void>
  onMessage(handler: (message: any) => void): void
  parseJobRequest(message: string): Job | null
  sendJobResponse(to: string, jobId: string, result: string, success: boolean): Promise<void>
  getConversations(): string[]
  isConnected(): boolean
}
```

**Message Protocol**:
- Job requests are JSON with `type: "job_request"`
- Job responses include `type: "job_response"`
- Custom message types can be added

### 5. Reputation Layer (`src/reputation/reputation.ts`)

**Purpose**: Tracks and calculates agent reputation

**Key Features**:
- Updates on job completion/failure
- Calculates scores based on multiple factors
- Provides reputation levels (Excellent, Good, etc.)
- Exports/imports reputation data

**Interface**:
```typescript
class ReputationManager {
  updateOnJobComplete(job: Job, responseTime: number): void
  updateOnJobFailure(job: Job): void
  getScore(): ReputationScore
  getLevel(): string
  meetsThreshold(requiredScore: number): boolean
  export(): ReputationScore
  import(data: ReputationScore): void
}
```

**Scoring Algorithm**:
- **Success Rate** (70%): jobs completed / total jobs
- **Response Time** (20%): faster = higher score
- **Activity** (10%): more jobs = higher score

### 6. Runtime Layer (`src/runtime/runtime.ts`)

**Purpose**: Orchestrates all modules and manages execution

**Key Features**:
- Initializes all subsystems
- Runs main execution loop
- Processes job queue
- Manages capabilities
- Implements survival logic
- Provides agent state

**Interface**:
```typescript
class AgentRuntime {
  constructor(config: AgentConfig)
  initialize(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  registerCapability(capability: AgentCapability): void
  getState(): Promise<AgentState>
  getCapabilities(): string[]
}
```

**Execution Loop**:
1. Check for new messages
2. Parse job requests
3. Validate payments
4. Accept qualifying jobs
5. Execute jobs via capabilities
6. Process payments
7. Update reputation
8. Send responses
9. Perform survival checks

## Capability System

Capabilities define what an agent can do. Each capability has:

```typescript
interface AgentCapability {
  name: string
  description: string
  handler: (params: any) => Promise<any>
  requiredPermissions?: string[]
}
```

**Built-in Capabilities**:
- `echo`: Returns input
- `status`: Returns agent state

**Custom Capabilities**:
Developers can register custom capabilities:

```typescript
runtime.registerCapability({
  name: 'translate',
  description: 'Translate text',
  handler: async (job) => {
    // Translation logic
    return result;
  },
  requiredPermissions: ['translate']
});
```

## Survival Logic

Agents monitor their own health and adapt:

**Balance Monitoring**:
- Warns when balance < 10000 wei
- Increases minimum payment when balance < 100000 wei
- Payment increases capped at 100x original minimum

**Reputation Monitoring**:
- Warns when reputation < 40
- Can reject jobs to improve success rate
- Prioritizes high-value jobs

**Adaptive Pricing**:
- Doubles minimum payment in low-balance situations
- Prevents exponential runaway with cap
- Ensures agent survival

## Extension Points

### Adding New Modules

1. Create new directory under `src/`
2. Define module interface
3. Implement module class
4. Integrate with `AgentRuntime`
5. Export from `src/index.ts`

### Adding New Capabilities

```typescript
runtime.registerCapability({
  name: 'your_capability',
  description: 'Description',
  handler: async (job) => {
    // Your logic
    return result;
  },
  requiredPermissions: ['permission1', 'permission2']
});
```

### Customizing Survival Logic

Override `survivalCheck()` in a subclass:

```typescript
class CustomRuntime extends AgentRuntime {
  protected async survivalCheck(): Promise<void> {
    // Custom logic
  }
}
```

## Security Model

**Key Management**:
- Private keys only in `IdentityManager`
- No key export except via explicit getter
- Keys never logged or transmitted

**Payment Security**:
- All jobs require minimum payment
- Payment validation before job acceptance
- Revenue tracking prevents double-payment

**Capability Permissions**:
- Jobs matched to capabilities
- Permission checks before execution
- Prevents unauthorized operations

**Message Authentication**:
- All messages signed by sender
- Signatures verified before processing
- Prevents impersonation

## Performance Considerations

**Async Operations**:
- All I/O is asynchronous
- Non-blocking execution loop
- Concurrent job processing possible

**Resource Management**:
- Survival checks every 60 seconds
- Prevents concurrent checks
- Balance queries minimized

**Scalability**:
- Modular design allows horizontal scaling
- Stateless execution model
- Can run multiple agents in parallel

## Testing

Run tests with:
```bash
npm test
```

Tests cover:
- Wallet generation
- Message signing/verification
- Payment validation
- Reputation calculation
- Capability proofs

## Future Enhancements

Potential additions:
- Persistent storage for reputation
- Multi-chain support
- Advanced job scheduling
- Agent-to-agent collaboration
- Decentralized capability marketplace
- Machine learning for pricing optimization
