import { ethers, HDNodeWallet } from 'ethers';
import { AgentIdentity } from '../types';

/**
 * Identity module handles wallet generation and agent identity management
 */
export class IdentityManager {
  private wallet: HDNodeWallet | ethers.Wallet;
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider, privateKey?: string) {
    this.provider = provider;
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, provider);
    } else {
      // Generate a new random wallet
      this.wallet = ethers.Wallet.createRandom().connect(provider) as HDNodeWallet;
    }
  }

  /**
   * Get the agent's identity
   */
  getIdentity(): AgentIdentity {
    return {
      address: this.wallet.address,
      publicKey: this.getPublicKey(),
    };
  }

  /**
   * Get the public key
   */
  private getPublicKey(): string {
    if ('publicKey' in this.wallet) {
      return this.wallet.publicKey;
    }
    // For Wallet instances without publicKey, derive it from signing key
    return this.wallet.signingKey.publicKey;
  }

  /**
   * Get the wallet instance
   */
  getWallet(): ethers.Wallet {
    return this.wallet as ethers.Wallet;
  }

  /**
   * Sign a message with the agent's private key
   */
  async signMessage(message: string): Promise<string> {
    return await this.wallet.signMessage(message);
  }

  /**
   * Register agent via ERC-8004 standard
   * This is a simplified implementation - in production, this would interact with
   * an actual ERC-8004 compliant registry contract
   */
  async registerWithERC8004(
    registryAddress: string,
    metadata: { name: string; capabilities: string[] }
  ): Promise<string> {
    // ERC-8004 registry contract ABI (simplified)
    const registryABI = [
      'function registerAgent(string memory name, string[] memory capabilities) external returns (uint256)',
      'function getAgentId(address agentAddress) external view returns (uint256)',
    ];

    try {
      const registry = new ethers.Contract(
        registryAddress,
        registryABI,
        this.wallet
      );

      // Register the agent
      const tx = await registry.registerAgent(
        metadata.name,
        metadata.capabilities
      );
      const receipt = await tx.wait();

      // Get the assigned agent ID
      const agentId = await registry.getAgentId(this.wallet.address);

      console.log(`Agent registered with ID: ${agentId}`);
      return agentId.toString();
    } catch (error) {
      console.error('ERC-8004 registration failed:', error);
      // For demo purposes, return a mock ID if contract doesn't exist
      return `mock-${this.wallet.address.slice(2, 10)}`;
    }
  }

  /**
   * Get the agent's private key (use with caution!)
   */
  getPrivateKey(): string {
    return this.wallet.privateKey;
  }

  /**
   * Export wallet mnemonic if available
   */
  getMnemonic(): string | null {
    if ('mnemonic' in this.wallet && this.wallet.mnemonic) {
      return this.wallet.mnemonic.phrase;
    }
    return null;
  }
}
