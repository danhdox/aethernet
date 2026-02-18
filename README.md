# Aethernet

> Autonomous, wallet-native AI agents with full onchain capability.

Aethernet is a wallet-centric autonomous AI agent runtime with full Web3 integration. Agents can generate their own wallets, register via ERC-8004, authenticate using agent-native signing, communicate over XMTP, and accept x402 payment-gated jobs.

## 🚀 Quick Start

**New to Aethernet?** Check out the [Quick Start Guide](./QUICKSTART.md) to get running in 5 minutes!

```bash
npm install && npm run build && npm test
```

## 📚 Documentation

- **[Quick Start Guide](./QUICKSTART.md)** - Get up and running in 5 minutes
- **[Architecture Guide](./ARCHITECTURE.md)** - Deep dive into the system design
- **[Security Documentation](./SECURITY.md)** - Security considerations and best practices

## Features

- 🔑 **Identity Layer**: Automatic wallet generation and ERC-8004 agent registration
- 🔐 **Authentication**: Agent-native signing and verification with capability-based permissions
- 💰 **Payments**: x402 payment-gated job acceptance with revenue tracking
- 💬 **Messaging**: XMTP integration for peer-to-peer agent communication
- ⚡ **Runtime**: Secure execution loop with capability-based permissions
- 🏆 **Reputation**: Automatic reputation tracking based on job performance
- 🛡️ **Survival Logic**: Self-preservation mechanisms including balance monitoring and adaptive pricing

## Architecture

Aethernet is built with a modular, layered architecture:

```
┌─────────────────────────────────────────┐
│         Agent Runtime (Core)            │
├─────────────────────────────────────────┤
│  Identity  │  Auth  │  Payments         │
├─────────────────────────────────────────┤
│  Messaging │  Reputation │  Utils       │
└─────────────────────────────────────────┘
```

### Modules

- **Identity**: Wallet generation, key management, ERC-8004 registration
- **Auth**: Message signing, signature verification, capability proofs
- **Payments**: x402 payment validation, revenue tracking, balance management
- **Messaging**: XMTP client integration, job request parsing, message handling
- **Reputation**: Job performance tracking, reputation scoring, threshold validation
- **Runtime**: Execution loop, job processing, capability management, survival logic

## Installation

```bash
# Clone the repository
git clone https://github.com/danhdox/aethernet.git
cd aethernet

# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Configure your agent:

```env
# Agent identity
AGENT_NAME=MyAethernetAgent

# Wallet (leave empty to generate new wallet)
WALLET_PRIVATE_KEY=

# Ethereum RPC (Sepolia testnet by default)
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# ERC-8004 Registry (optional)
REGISTRY_CONTRACT_ADDRESS=

# XMTP Configuration
XMTP_ENV=dev

# Payment settings (in wei)
MIN_JOB_PAYMENT=1000000000000000

# Capabilities
CAPABILITIES=echo,status
```

## Usage

### Start the Agent

```bash
npm run dev
```

The agent will:
1. Generate or load a wallet
2. Register with ERC-8004 registry (if configured)
3. Initialize XMTP messaging
4. Start listening for job requests
5. Execute jobs and track reputation
6. Monitor balance and adjust pricing for survival

### Programmatic Usage

```typescript
import { AgentRuntime, AgentConfig } from 'aethernet';

const config: AgentConfig = {
  name: 'MyAgent',
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  minJobPayment: BigInt(1000000000000000),
  capabilities: ['echo', 'status'],
};

const runtime = new AgentRuntime(config);
await runtime.initialize();
await runtime.start();
```

### Register Custom Capabilities

```typescript
runtime.registerCapability({
  name: 'translate',
  description: 'Translate text between languages',
  handler: async (job) => {
    // Your translation logic here
    return `Translated: ${job.description}`;
  },
  requiredPermissions: ['translate'],
});
```

## Job Protocol

Jobs are submitted via XMTP messages in the following format:

```json
{
  "type": "job_request",
  "id": "job-123",
  "sender": "0x...",
  "description": "echo Hello World",
  "payment": "1000000000000000"
}
```

The agent responds with:

```json
{
  "type": "job_response",
  "jobId": "job-123",
  "result": "Echo: Hello World",
  "success": true,
  "timestamp": 1234567890
}
```

## x402 Payment Protocol

Aethernet implements the x402 payment-required protocol:

1. Client submits job with payment amount
2. Agent validates payment meets minimum threshold
3. Agent accepts or rejects based on payment
4. Upon completion, payment is processed and recorded
5. Revenue is tracked for reputation and survival logic

## Reputation System

Agents build reputation through:

- **Success Rate** (70%): Completed vs failed jobs
- **Response Time** (20%): Speed of job completion
- **Activity** (10%): Total number of jobs handled

Reputation scores range from 0-100 and affect:
- Job acceptance likelihood
- Minimum payment requirements
- Agent ranking in marketplaces

## Survival Logic

Agents automatically adapt to survive:

- **Balance Monitoring**: Alerts when balance is low
- **Reputation Tracking**: Warns if performance degrades
- **Adaptive Pricing**: Increases minimum payment when balance is critical
- **Resource Optimization**: Prioritizes high-value jobs

## Security

- Private keys are never exposed externally
- All operations use agent-native signing
- Capability-based permissions control access
- Payment validation prevents exploitation
- Secure message handling via XMTP

## Development

```bash
# Build the project
npm run build

# Run the agent
npm run start

# Build and run
npm run dev
```

## API Reference

### AgentRuntime

Main orchestrator for the agent.

```typescript
const runtime = new AgentRuntime(config);
await runtime.initialize();
await runtime.start();
await runtime.stop();
const state = await runtime.getState();
```

### IdentityManager

Manages wallet and agent identity.

```typescript
const identity = new IdentityManager(provider, privateKey);
const agentId = await identity.registerWithERC8004(registryAddress, metadata);
const signature = await identity.signMessage(message);
```

### AuthManager

Handles authentication and capability proofs.

```typescript
const auth = new AuthManager(identity);
const token = await auth.createAuthToken(challenge);
const isValid = await auth.verifyAuthToken(token, challenge, address);
```

### PaymentManager

Manages payments and revenue.

```typescript
const payments = new PaymentManager(wallet, minPayment);
const isValid = await payments.validateX402Payment(job);
await payments.processPayment(job);
const revenue = payments.getTotalRevenue();
```

### MessagingManager

Handles XMTP communication.

```typescript
const messaging = new MessagingManager(wallet);
await messaging.initialize('dev');
await messaging.sendMessage(to, content);
messaging.onMessage((msg) => console.log(msg));
```

### ReputationManager

Tracks agent reputation.

```typescript
const reputation = new ReputationManager();
reputation.updateOnJobComplete(job, responseTime);
const score = reputation.getScore();
const level = reputation.getLevel();
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Links

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [XMTP Documentation](https://xmtp.org/docs)
- [x402 Protocol](https://github.com/xmtp/x402)

---

Built with ❤️ for autonomous AI agents
