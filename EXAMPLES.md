# Integration Examples

This document provides complete examples of integrating Aethernet into various use cases.

## Example 1: Simple Echo Agent

The most basic autonomous agent that echoes messages back.

```typescript
import { AgentRuntime, AgentConfig } from './index';

async function runEchoAgent() {
  const config: AgentConfig = {
    name: 'EchoAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(1000000000000000), // 0.001 ETH
    capabilities: ['echo'],
  };

  const runtime = new AgentRuntime(config);
  await runtime.initialize();
  await runtime.start();

  console.log('Echo agent is now listening for jobs...');
}

runEchoAgent();
```

## Example 2: Multi-Capability Agent

An agent with multiple capabilities for different tasks.

```typescript
import { AgentRuntime, AgentConfig, AgentCapability } from './index';

async function runMultiCapabilityAgent() {
  const config: AgentConfig = {
    name: 'MultiAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(500000000000000), // 0.0005 ETH
    capabilities: ['calculate', 'analyze', 'report'],
  };

  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Register calculate capability
  const calculateCapability: AgentCapability = {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    handler: async (job) => {
      const expression = job.description.replace('calculate ', '');
      try {
        // WARNING: In production, use a safe math evaluator
        const result = eval(expression);
        return `Result: ${result}`;
      } catch (error) {
        throw new Error(`Invalid expression: ${expression}`);
      }
    },
  };

  // Register analyze capability
  const analyzeCapability: AgentCapability = {
    name: 'analyze',
    description: 'Analyze text data',
    handler: async (job) => {
      const text = job.description.replace('analyze ', '');
      const wordCount = text.split(/\s+/).length;
      const charCount = text.length;
      const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
      
      return JSON.stringify({
        wordCount,
        charCount,
        sentences,
        averageWordLength: (charCount / wordCount).toFixed(2),
      });
    },
  };

  // Register report capability
  const reportCapability: AgentCapability = {
    name: 'report',
    description: 'Generate status reports',
    handler: async (job) => {
      const state = await runtime.getState();
      return JSON.stringify({
        agent: config.name,
        balance: state.balance.toString(),
        reputation: state.reputation.score,
        jobsCompleted: state.reputation.jobsCompleted,
        revenue: state.reputation.totalRevenue.toString(),
        timestamp: new Date().toISOString(),
      }, null, 2);
    },
  };

  runtime.registerCapability(calculateCapability);
  runtime.registerCapability(analyzeCapability);
  runtime.registerCapability(reportCapability);

  await runtime.start();
  console.log('Multi-capability agent is running...');
}

runMultiCapabilityAgent();
```

## Example 3: Premium Agent with Dynamic Pricing

An agent that adjusts pricing based on complexity.

```typescript
import { AgentRuntime, AgentConfig, AgentCapability, Job } from './index';

async function runPremiumAgent() {
  const config: AgentConfig = {
    name: 'PremiumAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(1000000000000000), // Base: 0.001 ETH
    capabilities: ['premium'],
  };

  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Custom job validation with dynamic pricing
  const premiumCapability: AgentCapability = {
    name: 'premium',
    description: 'Premium service with dynamic pricing',
    handler: async (job: Job) => {
      // Determine complexity
      const description = job.description.toLowerCase();
      let complexity: 'low' | 'medium' | 'high' = 'low';
      
      if (description.includes('complex') || description.includes('advanced')) {
        complexity = 'high';
      } else if (description.includes('moderate') || description.includes('detailed')) {
        complexity = 'medium';
      }

      // Check if payment matches complexity
      const requiredPayment = config.minJobPayment! * BigInt(
        complexity === 'low' ? 1 : complexity === 'medium' ? 2 : 5
      );

      if (job.payment < requiredPayment) {
        throw new Error(
          `Insufficient payment for ${complexity} complexity. ` +
          `Required: ${requiredPayment}, Provided: ${job.payment}`
        );
      }

      // Simulate processing time based on complexity
      const processingTime = complexity === 'low' ? 100 : 
                           complexity === 'medium' ? 500 : 2000;
      await new Promise(resolve => setTimeout(resolve, processingTime));

      return `Premium service completed (${complexity} complexity)`;
    },
    requiredPermissions: ['premium'],
  };

  runtime.registerCapability(premiumCapability);
  await runtime.start();

  console.log('Premium agent with dynamic pricing is running...');
}

runPremiumAgent();
```

## Example 4: Collaborative Agent Network

Multiple agents working together.

```typescript
import { AgentRuntime, AgentConfig } from './index';

async function runAgentNetwork() {
  // Create a coordinator agent
  const coordinatorConfig: AgentConfig = {
    name: 'CoordinatorAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(100000000000000), // 0.0001 ETH
    capabilities: ['coordinate'],
  };

  const coordinator = new AgentRuntime(coordinatorConfig);
  await coordinator.initialize();

  // Create worker agents
  const workers: AgentRuntime[] = [];
  for (let i = 0; i < 3; i++) {
    const workerConfig: AgentConfig = {
      name: `WorkerAgent${i + 1}`,
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      minJobPayment: BigInt(50000000000000), // 0.00005 ETH
      capabilities: ['work'],
    };

    const worker = new AgentRuntime(workerConfig);
    await worker.initialize();
    workers.push(worker);
  }

  // Start all agents
  await coordinator.start();
  for (const worker of workers) {
    await worker.start();
  }

  console.log('Agent network is operational:');
  console.log(`- Coordinator: ${(await coordinator.getState()).identity.address}`);
  for (let i = 0; i < workers.length; i++) {
    console.log(`- Worker ${i + 1}: ${(await workers[i].getState()).identity.address}`);
  }
}

runAgentNetwork();
```

## Example 5: Agent with External API Integration

An agent that calls external APIs to fulfill jobs.

```typescript
import { AgentRuntime, AgentConfig, AgentCapability } from './index';
import axios from 'axios';

async function runAPIAgent() {
  const config: AgentConfig = {
    name: 'APIAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(2000000000000000), // 0.002 ETH (higher for API calls)
    capabilities: ['weather', 'price'],
  };

  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Weather capability
  const weatherCapability: AgentCapability = {
    name: 'weather',
    description: 'Get weather information',
    handler: async (job) => {
      const location = job.description.replace('weather ', '');
      
      try {
        // Example: Call weather API
        // const response = await axios.get(
        //   `https://api.weatherapi.com/v1/current.json?q=${location}`
        // );
        // return JSON.stringify(response.data);
        
        // Mock response for demo
        return JSON.stringify({
          location,
          temperature: '72°F',
          condition: 'Sunny',
          humidity: '45%',
        });
      } catch (error) {
        throw new Error(`Failed to fetch weather for ${location}`);
      }
    },
    requiredPermissions: ['weather', 'api'],
  };

  // Price capability
  const priceCapability: AgentCapability = {
    name: 'price',
    description: 'Get cryptocurrency prices',
    handler: async (job) => {
      const symbol = job.description.replace('price ', '').toUpperCase();
      
      try {
        // Example: Call price API
        // const response = await axios.get(
        //   `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}`
        // );
        // return JSON.stringify(response.data);
        
        // Mock response for demo
        return JSON.stringify({
          symbol,
          price: symbol === 'ETH' ? '$2,450.00' : '$42,000.00',
          change24h: '+2.5%',
        });
      } catch (error) {
        throw new Error(`Failed to fetch price for ${symbol}`);
      }
    },
    requiredPermissions: ['price', 'api'],
  };

  runtime.registerCapability(weatherCapability);
  runtime.registerCapability(priceCapability);

  await runtime.start();
  console.log('API integration agent is running...');
}

runAPIAgent();
```

## Example 6: Agent with Persistent State

An agent that saves and restores its state.

```typescript
import { AgentRuntime, AgentConfig } from './index';
import fs from 'fs';

async function runStatefulAgent() {
  const STATE_FILE = './agent-state.json';

  const config: AgentConfig = {
    name: 'StatefulAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(1000000000000000),
    capabilities: ['echo', 'status'],
  };

  // Try to load existing wallet
  let privateKey: string | undefined;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const savedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      privateKey = savedState.privateKey;
      console.log('Restored agent from saved state');
    } catch (error) {
      console.error('Failed to restore state:', error);
    }
  }

  config.walletPrivateKey = privateKey;

  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Save state
  const state = await runtime.getState();
  const stateToSave = {
    privateKey: runtime['identity'].getPrivateKey(),
    address: state.identity.address,
    reputation: state.reputation,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2));
  console.log('Agent state saved');

  await runtime.start();

  // Auto-save state periodically
  setInterval(async () => {
    const currentState = await runtime.getState();
    stateToSave.reputation = currentState.reputation;
    stateToSave.timestamp = new Date().toISOString();
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave, null, 2));
    console.log('State auto-saved');
  }, 300000); // Every 5 minutes
}

runStatefulAgent();
```

## Example 7: Testing Job Submission

How to submit jobs to an agent for testing.

```typescript
import { Client } from '@xmtp/xmtp-js';
import { ethers } from 'ethers';

async function submitTestJob() {
  // Create a test wallet
  const wallet = ethers.Wallet.createRandom();
  console.log('Test client address:', wallet.address);

  // Initialize XMTP client
  const client = await Client.create(wallet, { env: 'dev' });
  console.log('XMTP client initialized');

  // Agent address (replace with your agent's address)
  const agentAddress = '0x...';

  // Start conversation
  const conversation = await client.conversations.newConversation(agentAddress);
  console.log('Conversation started with agent');

  // Create job request
  const jobRequest = {
    type: 'job_request',
    id: `test-job-${Date.now()}`,
    sender: wallet.address,
    description: 'echo Hello Aethernet!',
    payment: '1000000000000000', // 0.001 ETH
  };

  // Send job
  await conversation.send(JSON.stringify(jobRequest));
  console.log('Job sent:', jobRequest.id);

  // Listen for response
  for await (const message of await conversation.streamMessages()) {
    if (message.senderAddress === agentAddress) {
      console.log('Agent response:', message.content);
      
      try {
        const response = JSON.parse(message.content);
        if (response.type === 'job_response' && response.jobId === jobRequest.id) {
          console.log('Job completed!');
          console.log('Result:', response.result);
          console.log('Success:', response.success);
          break;
        }
      } catch (error) {
        console.log('Non-JSON response:', message.content);
      }
    }
  }
}

submitTestJob().catch(console.error);
```

## Integration Tips

### 1. Error Handling

Always wrap agent operations in try-catch:

```typescript
try {
  await runtime.initialize();
  await runtime.start();
} catch (error) {
  console.error('Agent error:', error);
  // Implement retry logic or alerting
}
```

### 2. Graceful Shutdown

Handle shutdown signals:

```typescript
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await runtime.stop();
  // Save state
  // Close connections
  process.exit(0);
});
```

### 3. Monitoring

Implement health checks:

```typescript
setInterval(async () => {
  const state = await runtime.getState();
  if (!state.isRunning) {
    console.error('Agent is not running!');
    // Send alert
  }
  if (state.balance < BigInt(10000)) {
    console.warn('Low balance!');
    // Send alert
  }
}, 60000); // Every minute
```

### 4. Logging

Use structured logging:

```typescript
const log = {
  info: (msg: string, data?: any) => {
    console.log(JSON.stringify({ level: 'info', msg, data, timestamp: Date.now() }));
  },
  error: (msg: string, error?: any) => {
    console.error(JSON.stringify({ level: 'error', msg, error, timestamp: Date.now() }));
  },
};

log.info('Agent started', { address: state.identity.address });
```

## Next Steps

- Customize these examples for your use case
- Add domain-specific capabilities
- Integrate with your existing systems
- Deploy to production with monitoring
- Scale with multiple agents

For more information, see:
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [SECURITY.md](./SECURITY.md) - Security best practices
- [README.md](./README.md) - Full documentation
