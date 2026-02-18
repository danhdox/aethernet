import { AgentRuntime, AgentConfig, AgentCapability } from './index';

/**
 * Example: Custom agent with translation capability
 */
async function exampleCustomAgent() {
  console.log('=== Custom Agent Example ===\n');

  // Configure agent
  const config: AgentConfig = {
    name: 'TranslatorAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    minJobPayment: BigInt(1000000000000000), // 0.001 ETH
    xmtpEnv: 'dev',
    capabilities: ['translate', 'echo', 'status'],
  };

  // Create runtime
  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Register custom translation capability
  const translateCapability: AgentCapability = {
    name: 'translate',
    description: 'Translate text (demo: just reverses the string)',
    handler: async (job) => {
      const text = job.description.replace('translate ', '');
      // In a real implementation, this would call a translation API
      const reversed = text.split('').reverse().join('');
      return `Translated: ${reversed}`;
    },
    requiredPermissions: ['translate'],
  };

  runtime.registerCapability(translateCapability);

  // Start the agent
  await runtime.start();

  // Display agent state after 5 seconds
  setTimeout(async () => {
    const state = await runtime.getState();
    console.log('\n=== Agent State ===');
    console.log(JSON.stringify(state, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    , 2));

    await runtime.stop();
    process.exit(0);
  }, 5000);
}

/**
 * Example: Minimal agent
 */
async function exampleMinimalAgent() {
  console.log('=== Minimal Agent Example ===\n');

  const config: AgentConfig = {
    name: 'MinimalAgent',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  };

  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Display agent info
  const state = await runtime.getState();
  console.log('Agent Address:', state.identity.address);
  console.log('Agent Balance:', state.balance.toString(), 'wei');
  console.log('Reputation Score:', state.reputation.score);
  console.log('Capabilities:', runtime.getCapabilities());

  await runtime.start();

  // Stop after 3 seconds
  setTimeout(async () => {
    await runtime.stop();
    process.exit(0);
  }, 3000);
}

// Run example based on argument
const example = process.argv[2] || 'minimal';

switch (example) {
  case 'custom':
    exampleCustomAgent().catch(console.error);
    break;
  case 'minimal':
  default:
    exampleMinimalAgent().catch(console.error);
    break;
}
