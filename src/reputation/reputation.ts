import { ReputationScore, Job } from '../types';

/**
 * Reputation module tracks and calculates agent reputation
 */
export class ReputationManager {
  private score: ReputationScore = {
    jobsCompleted: 0,
    jobsFailed: 0,
    totalRevenue: BigInt(0),
    averageResponseTime: 0,
    score: 100, // Start with perfect score
  };
  private responseTimes: number[] = [];

  /**
   * Update reputation after job completion
   */
  updateOnJobComplete(job: Job, responseTime: number): void {
    this.score.jobsCompleted++;
    this.score.totalRevenue += job.payment;
    this.responseTimes.push(responseTime);
    this.calculateAverageResponseTime();
    this.calculateScore();
    
    console.log(`Reputation updated: Score ${this.score.score}`);
  }

  /**
   * Update reputation after job failure
   */
  updateOnJobFailure(job: Job): void {
    this.score.jobsFailed++;
    this.calculateScore();
    
    console.log(`Reputation decreased: Score ${this.score.score}`);
  }

  /**
   * Calculate average response time
   */
  private calculateAverageResponseTime(): void {
    if (this.responseTimes.length === 0) {
      this.score.averageResponseTime = 0;
      return;
    }

    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    this.score.averageResponseTime = sum / this.responseTimes.length;
  }

  /**
   * Calculate overall reputation score (0-100)
   */
  private calculateScore(): void {
    const totalJobs = this.score.jobsCompleted + this.score.jobsFailed;
    if (totalJobs === 0) {
      this.score.score = 100;
      return;
    }

    // Success rate component (0-70 points)
    const successRate = this.score.jobsCompleted / totalJobs;
    const successScore = successRate * 70;

    // Response time component (0-20 points)
    // Faster response = higher score
    const avgResponseMs = this.score.averageResponseTime;
    let speedScore = 20;
    if (avgResponseMs > 1000) speedScore = 15;
    if (avgResponseMs > 5000) speedScore = 10;
    if (avgResponseMs > 10000) speedScore = 5;

    // Activity component (0-10 points)
    const activityScore = Math.min(totalJobs / 10, 1) * 10;

    this.score.score = Math.round(successScore + speedScore + activityScore);
  }

  /**
   * Get current reputation score
   */
  getScore(): ReputationScore {
    return { ...this.score };
  }

  /**
   * Get reputation level based on score
   */
  getLevel(): string {
    const score = this.score.score;
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Average';
    if (score >= 40) return 'Poor';
    return 'Very Poor';
  }

  /**
   * Check if agent meets reputation threshold for a job
   */
  meetsThreshold(requiredScore: number): boolean {
    return this.score.score >= requiredScore;
  }

  /**
   * Export reputation data
   */
  export(): ReputationScore {
    return { ...this.score };
  }

  /**
   * Import reputation data
   */
  import(data: ReputationScore): void {
    this.score = { ...data };
  }
}
