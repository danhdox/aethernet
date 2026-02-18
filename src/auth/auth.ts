import { ethers } from 'ethers';
import { IdentityManager } from '../identity/identity';

/**
 * Authentication module handles agent-native signing and verification
 */
export class AuthManager {
  private identity: IdentityManager;

  constructor(identity: IdentityManager) {
    this.identity = identity;
  }

  /**
   * Create an authentication token by signing a challenge
   */
  async createAuthToken(challenge: string): Promise<string> {
    const message = `Aethernet Agent Auth: ${challenge}`;
    const signature = await this.identity.signMessage(message);
    return signature;
  }

  /**
   * Verify an authentication token
   */
  async verifyAuthToken(
    token: string,
    challenge: string,
    expectedAddress: string
  ): Promise<boolean> {
    try {
      const message = `Aethernet Agent Auth: ${challenge}`;
      const recoveredAddress = ethers.verifyMessage(message, token);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error('Token verification failed:', error);
      return false;
    }
  }

  /**
   * Sign arbitrary data for agent operations
   */
  async signData(data: any): Promise<string> {
    const dataHash = ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(data))
    );
    return await this.identity.signMessage(dataHash);
  }

  /**
   * Verify signed data
   */
  async verifySignedData(
    data: any,
    signature: string,
    expectedAddress: string
  ): Promise<boolean> {
    try {
      const dataHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(data))
      );
      const recoveredAddress = ethers.verifyMessage(dataHash, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error('Data verification failed:', error);
      return false;
    }
  }

  /**
   * Create a capability proof for permission-based operations
   */
  async createCapabilityProof(
    capability: string,
    nonce: string
  ): Promise<string> {
    const message = `Capability: ${capability} | Nonce: ${nonce}`;
    return await this.identity.signMessage(message);
  }

  /**
   * Verify capability proof
   */
  async verifyCapabilityProof(
    proof: string,
    capability: string,
    nonce: string,
    expectedAddress: string
  ): Promise<boolean> {
    try {
      const message = `Capability: ${capability} | Nonce: ${nonce}`;
      const recoveredAddress = ethers.verifyMessage(message, proof);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      console.error('Capability proof verification failed:', error);
      return false;
    }
  }
}
