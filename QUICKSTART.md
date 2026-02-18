# Quick Start Guide

Get your Aethernet agent up and running in 5 minutes!

## Prerequisites

- Node.js 16+ and npm
- Basic understanding of Ethereum and Web3
- (Optional) Ethereum wallet with test ETH on Sepolia

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

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Give your agent a name
AGENT_NAME=MyFirstAgent

# Leave empty to generate a new wallet, or provide existing key
WALLET_PRIVATE_KEY=

# Use Sepolia testnet (free)
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Minimum payment in wei (0.001 ETH = 1000000000000000)
MIN_JOB_PAYMENT=1000000000000000

# XMTP environment
XMTP_ENV=dev

# Capabilities your agent supports
CAPABILITIES=echo,status
```

## Run Your Agent

### Option 1: Run Tests

See your agent in action with built-in tests:

```bash
npm test
```

You should see:
```
🧪 Testing Aethernet Core Components

1️⃣  Testing Identity Module...
   ✓ Wallet generated: 0x...
   ✓ Public key: 0x...

2️⃣  Testing Authentication Module...
   ✓ Auth token created: 0x...
   ✓ Token verification: PASS

...

✅ All core tests passed!
```

### Option 2: Run the Agent

Start your agent in autonomous mode:

```bash
npm run dev
```

You should see:
```
🚀 Starting Aethernet Agent...

Initializing Aethernet Agent...
Agent Address: 0x...
Agent Public Key: 0x...

📋 Agent Information:
   Name: MyFirstAgent
   Address: 0x...
   Balance: 0 wei
   Reputation Score: 100
   Capabilities: echo, status

Agent runtime started
```

The agent will:
- Listen for XMTP messages
- Accept jobs that meet payment requirements
- Execute capabilities
- Track reputation
- Monitor balance for survival

### Option 3: Programmatic Usage

Create a custom agent script:

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

## Next Steps

### 1. Add Custom Capabilities

Extend your agent with new skills:

```typescript
import { AgentRuntime, AgentCapability } from 'aethernet';

const runtime = new AgentRuntime(config);
await runtime.initialize();

// Add translation capability
const translateCapability: AgentCapability = {
  name: 'translate',
  description: 'Translate text',
  handler: async (job) => {
    // Your translation logic here
    const result = await translateAPI(job.description);
    return result;
  },
  requiredPermissions: ['translate'],
};

runtime.registerCapability(translateCapability);
await runtime.start();
```

### 2. Fund Your Agent

Get test ETH from a Sepolia faucet:
- [Sepolia Faucet](https://sepoliafaucet.com/)
- [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)

Send test ETH to your agent's address (shown at startup).

### 3. Register with ERC-8004

If you have an ERC-8004 registry contract:

```env
REGISTRY_CONTRACT_ADDRESS=0x...
```

Your agent will automatically register on startup.

### 4. Test XMTP Messaging

Send a job request to your agent via XMTP:

```typescript
import { Client } from '@xmtp/xmtp-js';
import { ethers } from 'ethers';

const wallet = ethers.Wallet.createRandom();
const client = await Client.create(wallet, { env: 'dev' });

const conversation = await client.conversations.newConversation(
  'YOUR_AGENT_ADDRESS'
);

const jobRequest = {
  type: 'job_request',
  id: 'job-123',
  sender: wallet.address,
  description: 'echo Hello Agent!',
  payment: '1000000000000000', // 0.001 ETH
};

await conversation.send(JSON.stringify(jobRequest));
```

Your agent will:
1. Receive the message
2. Validate payment
3. Execute the echo capability
4. Send response back
5. Update reputation

## Understanding Agent Output

### Startup Messages

```
Agent Address: 0x...     ← Your agent's Ethereum address
Agent Public Key: 0x...  ← Public key for verification
```

### Status Updates

```
📊 Status Update:
   Balance: 1000000000000000 wei      ← Current ETH balance
   Active Jobs: 0                     ← Jobs being processed
   Total Jobs Completed: 5            ← Lifetime job count
   Reputation Score: 95               ← Performance score (0-100)
   Total Revenue: 5000000000000000 wei ← Lifetime earnings
```

### Survival Checks

```
Survival Check - Balance: 1000000000000000, Reputation: 95
```

If balance is low:
```
⚠️  Low balance warning! Agent may need funding.
Increased minimum payment to 2000000000000000 for survival
```

## Troubleshooting

### "Failed to initialize XMTP client"

**Cause**: Network connectivity or XMTP service unavailable
**Solution**: Agent continues in offline mode. For production, ensure network access.

### "JsonRpcProvider failed to detect network"

**Cause**: RPC endpoint unreachable or incorrect
**Solution**: 
- Check `RPC_URL` in `.env`
- Try a different RPC provider
- Ensure network connectivity

### "Payment insufficient"

**Cause**: Job payment below minimum threshold
**Solution**: Increase job payment or lower `MIN_JOB_PAYMENT` in `.env`

### Tests pass but agent doesn't receive jobs

**Cause**: XMTP not connected or no jobs sent
**Solution**:
- Verify XMTP initialization in logs
- Send a test job (see "Test XMTP Messaging" above)
- Check sender is using same XMTP environment (dev/production)

## Example: Complete Workflow

1. **Start agent**:
   ```bash
   npm run dev
   ```

2. **Note agent address** from output:
   ```
   Agent Address: 0x1234...
   ```

3. **Fund agent** with test ETH from faucet

4. **Send job via XMTP** (from another client):
   ```json
   {
     "type": "job_request",
     "id": "job-001",
     "description": "echo Hello World",
     "payment": "1000000000000000"
   }
   ```

5. **Agent processes job**:
   ```
   Job request received: job-001
   Job job-001 accepted
   Job job-001 completed in 150ms
   Payment processed: 1000000000000000 wei
   Reputation updated: Score 95
   ```

6. **Check updated stats**:
   ```
   📊 Status Update:
   Balance: 1000000000000000 wei
   Active Jobs: 0
   Total Jobs Completed: 1
   Reputation Score: 95
   Total Revenue: 1000000000000000 wei
   ```

## What's Next?

- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for deep dive
- Review [SECURITY.md](./SECURITY.md) for production deployment
- Check examples in `src/examples.ts`
- Join community discussions
- Build custom capabilities
- Deploy to mainnet (after thorough testing!)

## Getting Help

- Check existing issues on GitHub
- Read the full README
- Review architecture documentation
- Examine test code for examples

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests |
| `npm run dev` | Build and start agent |
| `npm start` | Start agent (requires build) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENT_NAME` | No | AethernetAgent | Agent identifier |
| `WALLET_PRIVATE_KEY` | No | (generated) | Existing wallet key |
| `RPC_URL` | Yes | (Sepolia) | Ethereum RPC endpoint |
| `REGISTRY_CONTRACT_ADDRESS` | No | - | ERC-8004 registry |
| `XMTP_ENV` | No | dev | XMTP environment |
| `MIN_JOB_PAYMENT` | No | 0.001 ETH | Minimum wei amount |
| `CAPABILITIES` | No | echo,status | Comma-separated list |

Happy building! 🚀
