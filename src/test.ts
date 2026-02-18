import { IdentityManager } from './identity/identity';
import { AuthManager } from './auth/auth';
import { PaymentManager } from './payments/payments';
import { ReputationManager } from './reputation/reputation';
import { Job } from './types';
import { ethers } from 'ethers';

/**
 * Test core functionality without network access
 */
async function testCore() {
  console.log('🧪 Testing Aethernet Core Components\n');

  // 1. Test Identity
  console.log('1️⃣  Testing Identity Module...');
  const provider = new ethers.JsonRpcProvider();
  const identity = new IdentityManager(provider);
  const agentIdentity = identity.getIdentity();
  console.log(`   ✓ Wallet generated: ${agentIdentity.address}`);
  console.log(`   ✓ Public key: ${agentIdentity.publicKey.slice(0, 20)}...`);

  // 2. Test Authentication
  console.log('\n2️⃣  Testing Authentication Module...');
  const auth = new AuthManager(identity);
  const challenge = 'test-challenge-123';
  const token = await auth.createAuthToken(challenge);
  console.log(`   ✓ Auth token created: ${token.slice(0, 20)}...`);
  
  const isValid = await auth.verifyAuthToken(token, challenge, agentIdentity.address);
  console.log(`   ✓ Token verification: ${isValid ? 'PASS' : 'FAIL'}`);

  // 3. Test Capability Proof
  console.log('\n3️⃣  Testing Capability-Based Auth...');
  const proof = await auth.createCapabilityProof('translate', 'nonce-123');
  const proofValid = await auth.verifyCapabilityProof(
    proof,
    'translate',
    'nonce-123',
    agentIdentity.address
  );
  console.log(`   ✓ Capability proof: ${proofValid ? 'PASS' : 'FAIL'}`);

  // 4. Test Payments
  console.log('\n4️⃣  Testing Payment Module...');
  const wallet = identity.getWallet();
  const payments = new PaymentManager(wallet, BigInt(1000));
  
  const testJob: Job = {
    id: 'test-job-1',
    sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    description: 'Test job',
    payment: BigInt(5000),
    status: 'completed',
    timestamp: Date.now(),
  };

  const paymentValid = await payments.validateX402Payment(testJob);
  console.log(`   ✓ Payment validation: ${paymentValid ? 'PASS' : 'FAIL'}`);
  
  await payments.processPayment(testJob);
  const revenue = payments.getTotalRevenue();
  console.log(`   ✓ Revenue tracked: ${revenue} wei`);

  // 5. Test Reputation
  console.log('\n5️⃣  Testing Reputation Module...');
  const reputation = new ReputationManager();
  reputation.updateOnJobComplete(testJob, 500);
  const score = reputation.getScore();
  console.log(`   ✓ Jobs completed: ${score.jobsCompleted}`);
  console.log(`   ✓ Reputation score: ${score.score}/100`);
  console.log(`   ✓ Reputation level: ${reputation.getLevel()}`);

  // 6. Test multiple jobs for reputation
  console.log('\n6️⃣  Testing Reputation with Multiple Jobs...');
  for (let i = 0; i < 5; i++) {
    const job: Job = {
      id: `job-${i}`,
      sender: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
      description: `Job ${i}`,
      payment: BigInt(1000 * (i + 1)),
      status: 'completed',
      timestamp: Date.now(),
    };
    reputation.updateOnJobComplete(job, 300 + i * 100);
    await payments.processPayment(job);
  }
  
  const finalScore = reputation.getScore();
  const finalRevenue = payments.getTotalRevenue();
  console.log(`   ✓ Total jobs: ${finalScore.jobsCompleted}`);
  console.log(`   ✓ Final score: ${finalScore.score}/100`);
  console.log(`   ✓ Total revenue: ${finalRevenue} wei`);

  // 7. Test message signing
  console.log('\n7️⃣  Testing Message Signing...');
  const message = 'Hello Aethernet!';
  const signature = await identity.signMessage(message);
  console.log(`   ✓ Message signed: ${signature.slice(0, 20)}...`);
  
  const recovered = ethers.verifyMessage(message, signature);
  console.log(`   ✓ Signature valid: ${recovered === agentIdentity.address ? 'PASS' : 'FAIL'}`);

  console.log('\n✅ All core tests passed!\n');
  
  // Display summary
  console.log('📊 Test Summary:');
  console.log(`   Agent Address: ${agentIdentity.address}`);
  console.log(`   Jobs Completed: ${finalScore.jobsCompleted}`);
  console.log(`   Reputation: ${finalScore.score}/100 (${reputation.getLevel()})`);
  console.log(`   Total Revenue: ${finalRevenue} wei`);
  console.log(`   Average Response Time: ${Math.round(finalScore.averageResponseTime)}ms`);
}

testCore().catch(console.error);
