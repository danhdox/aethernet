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
  // Convert bigint to string to avoid precision loss
  const weiStr = wei.toString();
  const len = weiStr.length;
  
  if (len <= 18) {
    const padded = weiStr.padStart(18, '0');
    return `0.${padded}`;
  } else {
    const integerPart = weiStr.slice(0, len - 18);
    const decimalPart = weiStr.slice(len - 18);
    return `${integerPart}.${decimalPart}`;
  }
}

/**
 * Parse ether to wei
 */
export function parseEther(ether: string): bigint {
  const parts = ether.split('.');
  const integerPart = parts[0] || '0';
  const decimalPart = (parts[1] || '').padEnd(18, '0').slice(0, 18);
  return BigInt(integerPart + decimalPart);
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
