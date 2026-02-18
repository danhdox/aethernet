import { ethers } from 'ethers';
import { IdentityManager } from '../identity/identity';
import { AuthManager } from '../auth/auth';
import { PaymentManager } from '../payments/payments';
import { MessagingManager } from '../messaging/messaging';
import { ReputationManager } from '../reputation/reputation';
import {
  AgentConfig,
  AgentState,
  Job,
  AgentCapability,
  AgentIdentity,
} from '../types';

/**
 * Runtime module orchestrates the agent's execution loop and manages capabilities
 */
export class AgentRuntime {
  private identity: IdentityManager;
  private auth: AuthManager;
  private payments: PaymentManager;
  private messaging: MessagingManager;
  private reputation: ReputationManager;
  private capabilities: Map<string, AgentCapability> = new Map();
  private jobs: Map<string, Job> = new Map();
  private isRunning: boolean = false;
  private config: AgentConfig;
  private survivalCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: AgentConfig) {
    this.config = config;

    // Initialize provider
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Initialize identity
    this.identity = new IdentityManager(provider, config.walletPrivateKey);

    // Initialize other modules
    this.auth = new AuthManager(this.identity);
    this.payments = new PaymentManager(
      this.identity.getWallet(),
      config.minJobPayment || BigInt(0)
    );
    this.messaging = new MessagingManager(this.identity.getWallet());
    this.reputation = new ReputationManager();

    // Register default capabilities
    this.registerDefaultCapabilities();
  }

  /**
   * Initialize the agent runtime
   */
  async initialize(): Promise<void> {
    console.log('Initializing Aethernet Agent...');

    const identity = this.identity.getIdentity();
    console.log(`Agent Address: ${identity.address}`);
    console.log(`Agent Public Key: ${identity.publicKey}`);

    // Initialize XMTP messaging
    await this.messaging.initialize(this.config.xmtpEnv);

    // Register with ERC-8004 if registry address provided
    if (this.config.registryContractAddress) {
      const agentId = await this.identity.registerWithERC8004(
        this.config.registryContractAddress,
        {
          name: this.config.name,
          capabilities: this.config.capabilities || [],
        }
      );
      console.log(`Agent registered with ID: ${agentId}`);
    }

    // Set up message handler
    this.messaging.onMessage((message) => this.handleMessage(message));

    console.log('Agent initialized successfully');
  }

  /**
   * Start the agent runtime
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Agent is already running');
      return;
    }

    this.isRunning = true;
    console.log('Agent runtime started');

    // Start listening for messages
    if (this.messaging.isConnected()) {
      this.messaging.startListening().catch(console.error);
    }

    // Start survival logic
    this.startSurvivalLogic();

    // Main execution loop
    this.executionLoop();
  }

  /**
   * Stop the agent runtime
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.survivalCheckInterval) {
      clearInterval(this.survivalCheckInterval);
    }
    console.log('Agent runtime stopped');
  }

  /**
   * Main execution loop
   */
  private async executionLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Process pending jobs
        await this.processPendingJobs();

        // Wait before next iteration
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error in execution loop:', error);
      }
    }
  }

  /**
   * Process pending jobs
   */
  private async processPendingJobs(): Promise<void> {
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'accepted') {
        await this.executeJob(jobId);
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: any): Promise<void> {
    console.log(`Received message from ${message.sender}`);

    // Try to parse as job request
    const job = this.messaging.parseJobRequest(message.content);
    if (job) {
      await this.handleJobRequest(job);
    }
  }

  /**
   * Handle job request
   */
  private async handleJobRequest(job: Job): Promise<void> {
    console.log(`Job request received: ${job.id}`);

    // Validate payment
    const paymentValid = await this.payments.validateX402Payment(job);
    if (!paymentValid) {
      console.log(`Job ${job.id} rejected: insufficient payment`);
      await this.messaging.sendJobResponse(
        job.sender,
        job.id,
        'Payment insufficient',
        false
      );
      return;
    }

    // Accept job
    job.status = 'accepted';
    this.jobs.set(job.id, job);
    console.log(`Job ${job.id} accepted`);
  }

  /**
   * Execute a job
   */
  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const startTime = Date.now();
    job.status = 'running';

    try {
      // Execute job based on description
      const result = await this.runJobLogic(job);

      // Mark as completed
      job.status = 'completed';
      job.result = result;
      const responseTime = Date.now() - startTime;

      // Process payment
      await this.payments.processPayment(job);

      // Update reputation
      this.reputation.updateOnJobComplete(job, responseTime);

      // Send response
      await this.messaging.sendJobResponse(job.sender, job.id, result, true);

      console.log(`Job ${job.id} completed in ${responseTime}ms`);
    } catch (error) {
      job.status = 'failed';
      this.reputation.updateOnJobFailure(job);

      await this.messaging.sendJobResponse(
        job.sender,
        job.id,
        `Error: ${error}`,
        false
      );

      console.error(`Job ${job.id} failed:`, error);
    }
  }

  /**
   * Run job logic based on capabilities
   */
  private async runJobLogic(job: Job): Promise<string> {
    // Try to match job to a capability
    for (const [name, capability] of this.capabilities.entries()) {
      if (job.description.toLowerCase().includes(name.toLowerCase())) {
        // Check permissions
        if (
          capability.requiredPermissions &&
          !this.hasPermissions(capability.requiredPermissions)
        ) {
          throw new Error(`Insufficient permissions for capability: ${name}`);
        }

        return await capability.handler(job);
      }
    }

    // Default handler
    return `Processed: ${job.description}`;
  }

  /**
   * Register a capability
   */
  registerCapability(capability: AgentCapability): void {
    this.capabilities.set(capability.name, capability);
    console.log(`Capability registered: ${capability.name}`);
  }

  /**
   * Register default capabilities
   */
  private registerDefaultCapabilities(): void {
    this.registerCapability({
      name: 'echo',
      description: 'Echo back the input',
      handler: async (job: Job) => {
        return `Echo: ${job.description}`;
      },
    });

    this.registerCapability({
      name: 'status',
      description: 'Get agent status',
      handler: async () => {
        const state = await this.getState();
        return JSON.stringify(state, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v
        );
      },
    });
  }

  /**
   * Check if agent has required permissions
   */
  private hasPermissions(required: string[]): boolean {
    const agentCapabilities = this.config.capabilities || [];
    return required.every((perm) => agentCapabilities.includes(perm));
  }

  /**
   * Start survival logic
   */
  private startSurvivalLogic(): void {
    // Check balance and reputation periodically
    this.survivalCheckInterval = setInterval(async () => {
      await this.survivalCheck();
    }, 60000); // Every minute
  }

  /**
   * Perform survival check
   */
  private async survivalCheck(): Promise<void> {
    const balance = await this.payments.getBalance();
    const reputation = this.reputation.getScore();

    console.log(`Survival Check - Balance: ${balance}, Reputation: ${reputation.score}`);

    // Check if balance is critically low
    if (balance < BigInt(10000)) {
      console.warn('⚠️  Low balance warning! Agent may need funding.');
    }

    // Check reputation
    if (reputation.score < 40) {
      console.warn('⚠️  Low reputation warning! Agent performance needs improvement.');
    }

    // Survival strategy: adjust minimum payment based on balance
    if (balance < BigInt(100000)) {
      const newMinPayment = this.payments.getMinPayment() * BigInt(2);
      this.payments.setMinPayment(newMinPayment);
      console.log(`Increased minimum payment to ${newMinPayment} for survival`);
    }
  }

  /**
   * Get current agent state
   */
  async getState(): Promise<AgentState> {
    const identity = this.identity.getIdentity();
    const balance = await this.payments.getBalance();
    const reputation = this.reputation.getScore();
    const activeJobs = Array.from(this.jobs.values()).filter(
      (j) => j.status === 'running' || j.status === 'accepted'
    );

    return {
      identity,
      isRunning: this.isRunning,
      balance,
      reputation,
      activeJobs,
      revenue: this.payments.getRevenueHistory(),
    };
  }

  /**
   * Get registered capabilities
   */
  getCapabilities(): string[] {
    return Array.from(this.capabilities.keys());
  }
}
