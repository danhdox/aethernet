import { Client, Conversation } from '@xmtp/xmtp-js';
import { ethers } from 'ethers';
import { Job } from '../types';

/**
 * Messaging module handles XMTP communication
 */
export class MessagingManager {
  private client: Client | null = null;
  private wallet: ethers.Wallet;
  private conversations: Map<string, Conversation> = new Map();
  private messageHandlers: Array<(message: any) => void> = [];

  constructor(wallet: ethers.Wallet) {
    this.wallet = wallet;
  }

  /**
   * Initialize XMTP client
   */
  async initialize(env: 'dev' | 'production' | 'local' = 'dev'): Promise<void> {
    try {
      this.client = await Client.create(this.wallet, { env });
      console.log('XMTP client initialized');
    } catch (error) {
      console.error('Failed to initialize XMTP client:', error);
      // For demo purposes, continue without XMTP
      console.log('Running in XMTP offline mode');
    }
  }

  /**
   * Send a message to an address
   */
  async sendMessage(to: string, content: string): Promise<void> {
    if (!this.client) {
      console.log(`[Offline] Would send to ${to}: ${content}`);
      return;
    }

    try {
      let conversation = this.conversations.get(to);
      if (!conversation) {
        conversation = await this.client.conversations.newConversation(to);
        this.conversations.set(to, conversation);
      }

      await conversation.send(content);
      console.log(`Message sent to ${to}`);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }

  /**
   * Listen for incoming messages
   */
  async startListening(): Promise<void> {
    if (!this.client) {
      console.log('XMTP client not initialized, skipping message listening');
      return;
    }

    try {
      const stream = await this.client.conversations.stream();
      
      for await (const conversation of stream) {
        console.log(`New conversation with ${conversation.peerAddress}`);
        this.conversations.set(conversation.peerAddress, conversation);
        
        // Listen for messages in this conversation
        this.listenToConversation(conversation);
      }
    } catch (error) {
      console.error('Error listening for messages:', error);
    }
  }

  /**
   * Listen to a specific conversation
   */
  private async listenToConversation(conversation: Conversation): Promise<void> {
    try {
      for await (const message of await conversation.streamMessages()) {
        console.log(`Message from ${message.senderAddress}: ${message.content}`);
        
        // Notify all registered handlers
        this.messageHandlers.forEach(handler => {
          try {
            handler({
              sender: message.senderAddress,
              content: message.content,
              timestamp: message.sent.getTime(),
            });
          } catch (error) {
            console.error('Message handler error:', error);
          }
        });
      }
    } catch (error) {
      console.error('Error streaming messages:', error);
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Parse job request from message
   */
  parseJobRequest(message: string): Job | null {
    try {
      const data = JSON.parse(message);
      if (data.type === 'job_request') {
        return {
          id: data.id || `job-${Date.now()}`,
          sender: data.sender,
          description: data.description,
          payment: BigInt(data.payment || 0),
          status: 'pending',
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      console.error('Failed to parse job request:', error);
    }
    return null;
  }

  /**
   * Send job response
   */
  async sendJobResponse(to: string, jobId: string, result: string, success: boolean): Promise<void> {
    const response = JSON.stringify({
      type: 'job_response',
      jobId,
      result,
      success,
      timestamp: Date.now(),
    });
    await this.sendMessage(to, response);
  }

  /**
   * Get all conversations
   */
  getConversations(): string[] {
    return Array.from(this.conversations.keys());
  }

  /**
   * Check if XMTP is connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }
}
