/**
 * Utility functions for Aethernet
 */

import crypto from 'crypto';

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format wei to ether
 */
export function formatEther(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

/**
 * Parse ether to wei
 */
export function parseEther(ether: string): bigint {
  return BigInt(Math.floor(parseFloat(ether) * 1e18));
}

/**
 * Validate Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Truncate address for display
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Calculate percentage
 */
export function calculatePercentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}
