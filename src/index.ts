import { AgentRuntime } from './runtime/runtime';
import { AgentConfig } from './types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main entry point for Aethernet agent
 */
async function main() {
  console.log('🚀 Starting Aethernet Agent...\n');

  // Configure agent
  const config: AgentConfig = {
    name: process.env.AGENT_NAME || 'AethernetAgent',
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
    rpcUrl: process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    registryContractAddress: process.env.REGISTRY_CONTRACT_ADDRESS,
    xmtpEnv: (process.env.XMTP_ENV as 'dev' | 'production' | 'local') || 'dev',
    minJobPayment: process.env.MIN_JOB_PAYMENT
      ? BigInt(process.env.MIN_JOB_PAYMENT)
      : BigInt(1000000000000000), // 0.001 ETH default
    capabilities: process.env.CAPABILITIES
      ? process.env.CAPABILITIES.split(',')
      : ['echo', 'status'],
  };

  // Create and initialize runtime
  const runtime = new AgentRuntime(config);
  await runtime.initialize();

  // Display agent info
  const state = await runtime.getState();
  console.log('\n📋 Agent Information:');
  console.log(`   Name: ${config.name}`);
  console.log(`   Address: ${state.identity.address}`);
  console.log(`   Balance: ${state.balance} wei`);
  console.log(`   Reputation Score: ${state.reputation.score}`);
  console.log(`   Capabilities: ${runtime.getCapabilities().join(', ')}`);
  console.log('');

  // Start the agent
  await runtime.start();

  // Keep the process running
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down agent...');
    await runtime.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Shutting down agent...');
    await runtime.stop();
    process.exit(0);
  });

  // Log status every 30 seconds
  setInterval(async () => {
    const currentState = await runtime.getState();
    console.log(`\n📊 Status Update:`);
    console.log(`   Balance: ${currentState.balance} wei`);
    console.log(`   Active Jobs: ${currentState.activeJobs.length}`);
    console.log(`   Total Jobs Completed: ${currentState.reputation.jobsCompleted}`);
    console.log(`   Reputation Score: ${currentState.reputation.score}`);
    console.log(`   Total Revenue: ${currentState.reputation.totalRevenue} wei`);
  }, 30000);
}

// Export classes for external use
export { AgentRuntime } from './runtime/runtime';
export { IdentityManager } from './identity/identity';
export { AuthManager } from './auth/auth';
export { PaymentManager } from './payments/payments';
export { MessagingManager } from './messaging/messaging';
export { ReputationManager } from './reputation/reputation';
export * from './types';

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
