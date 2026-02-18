import { ethers } from 'ethers';
import { Job, RevenueRecord } from '../types';

/**
 * Payment module handles x402 payment-gated jobs and revenue tracking
 */
export class PaymentManager {
  private wallet: ethers.Wallet;
  private minPayment: bigint;
  private revenue: RevenueRecord[] = [];

  constructor(wallet: ethers.Wallet, minPayment: bigint = BigInt(0)) {
    this.wallet = wallet;
    this.minPayment = minPayment;
  }

  /**
   * Validate x402 payment for a job
   * x402 is a protocol for HTTP payment-required responses
   */
  async validateX402Payment(job: Job): Promise<boolean> {
    // Check if payment meets minimum requirement
    if (job.payment < this.minPayment) {
      console.log(
        `Payment ${job.payment} below minimum ${this.minPayment}`
      );
      return false;
    }

    // In a real implementation, this would verify on-chain payment
    // For now, we simulate payment validation
    return job.payment > BigInt(0);
  }

  /**
   * Process payment for a completed job
   */
  async processPayment(job: Job): Promise<void> {
    if (job.status !== 'completed') {
      throw new Error('Cannot process payment for incomplete job');
    }

    // Record revenue
    const record: RevenueRecord = {
      timestamp: Date.now(),
      amount: job.payment,
      source: job.sender,
      jobId: job.id,
    };

    this.revenue.push(record);
    console.log(`Payment processed: ${job.payment} wei from ${job.sender}`);
  }

  /**
   * Get total revenue
   */
  getTotalRevenue(): bigint {
    return this.revenue.reduce((sum, record) => sum + record.amount, BigInt(0));
  }

  /**
   * Get revenue history
   */
  getRevenueHistory(): RevenueRecord[] {
    return [...this.revenue];
  }

  /**
   * Get agent's current balance
   */
  async getBalance(): Promise<bigint> {
    return await this.wallet.provider!.getBalance(this.wallet.address);
  }

  /**
   * Withdraw funds to another address
   */
  async withdraw(to: string, amount: bigint): Promise<string> {
    const balance = await this.getBalance();
    if (balance < amount) {
      throw new Error('Insufficient balance');
    }

    const tx = await this.wallet.sendTransaction({
      to,
      value: amount,
    });

    const receipt = await tx.wait();
    console.log(`Withdrew ${amount} wei to ${to}`);
    return receipt!.hash;
  }

  /**
   * Set minimum payment requirement
   */
  setMinPayment(amount: bigint): void {
    this.minPayment = amount;
  }

  /**
   * Get minimum payment requirement
   */
  getMinPayment(): bigint {
    return this.minPayment;
  }

  /**
   * Calculate payment for a job based on complexity
   */
  calculateJobPayment(complexity: 'low' | 'medium' | 'high'): bigint {
    const basePayment = this.minPayment;
    switch (complexity) {
      case 'low':
        return basePayment;
      case 'medium':
        return basePayment * BigInt(2);
      case 'high':
        return basePayment * BigInt(5);
      default:
        return basePayment;
    }
  }
}
