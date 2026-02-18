import type { AgentMessage, HexAddress, MessagingTransport } from "@aethernet/shared-types";
import type { Client, Identifier } from "@xmtp/node-sdk";

export interface SignerAccount {
  address: HexAddress;
  signMessage(input: { message: string }): Promise<string>;
}

export interface RelayTransportOptions {
  relayUrl: string;
  account: SignerAccount;
}

export interface XmtpMessagingTransportOptions {
  account: SignerAccount;
  env?: "local" | "dev" | "production";
  dbPath?: string | null;
}

export class RelayMessagingTransport implements MessagingTransport {
  readonly name = "relay-xmtp-compatible";
  private readonly relayUrl: string;
  private readonly account: SignerAccount;
  private readonly knownThreads = new Map<string, { peer?: string; updatedAt?: string }>();

  constructor(options: RelayTransportOptions) {
    this.relayUrl = options.relayUrl.replace(/\/$/, "");
    this.account = options.account;
  }

  async send(input: {
    to: string;
    content: string;
    threadId?: string;
  }): Promise<{ id: string }> {
    const threadId = input.threadId ?? `dm:${input.to.toLowerCase()}`;
    const timestamp = new Date().toISOString();
    const canonical = [
      "aethernet:message:send",
      this.account.address.toLowerCase(),
      input.to.toLowerCase(),
      timestamp,
      input.content,
    ].join("|");

    const signature = await this.account.signMessage({ message: canonical });

    const response = await fetch(`${this.relayUrl}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.account.address,
        to: input.to,
        content: input.content,
        threadId,
        signature,
        timestamp,
      }),
    });

    if (!response.ok) {
      throw new Error(`Message send failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as { id: string };
    this.knownThreads.set(threadId, {
      peer: input.to,
      updatedAt: timestamp,
    });
    return { id: payload.id };
  }

  async poll(input?: { since?: string; limit?: number }): Promise<AgentMessage[]> {
    const timestamp = new Date().toISOString();
    const canonical = [
      "aethernet:message:poll",
      this.account.address.toLowerCase(),
      timestamp,
    ].join("|");

    const signature = await this.account.signMessage({ message: canonical });

    const response = await fetch(`${this.relayUrl}/v1/messages/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": this.account.address,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body: JSON.stringify({
        since: input?.since,
        limit: input?.limit,
      }),
    });

    if (!response.ok) {
      throw new Error(`Message poll failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      messages: Array<{
        id: string;
        from: HexAddress;
        to: HexAddress;
        content: string;
        threadId?: string;
        receivedAt: string;
      }>;
    };

    const messages = payload.messages.map((message) => ({
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.content,
      threadId: message.threadId,
      receivedAt: message.receivedAt,
    }));

    for (const message of messages) {
      const threadId = message.threadId ?? `dm:${message.from.toLowerCase()}`;
      this.knownThreads.set(threadId, {
        peer: message.from,
        updatedAt: message.receivedAt,
      });
    }

    return messages;
  }

  async listThreads(limit = 100): Promise<Array<{ id: string; peer?: string; updatedAt?: string }>> {
    return Array.from(this.knownThreads.entries())
      .map(([id, value]) => ({
        id,
        peer: value.peer,
        updatedAt: value.updatedAt,
      }))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, limit);
  }
}

export class InMemoryMessagingTransport implements MessagingTransport {
  readonly name = "in-memory";
  private readonly account: SignerAccount;
  private readonly queue: AgentMessage[] = [];
  private readonly knownThreads = new Map<string, { peer?: string; updatedAt?: string }>();

  constructor(account: SignerAccount) {
    this.account = account;
  }

  async send(input: {
    to: string;
    content: string;
    threadId?: string;
  }): Promise<{ id: string }> {
    const id = `msg_${Math.random().toString(16).slice(2, 10)}`;
    const threadId = input.threadId ?? `dm:${input.to.toLowerCase()}`;
    const receivedAt = new Date().toISOString();
    this.queue.push({
      id,
      from: this.account.address,
      to: input.to,
      content: input.content,
      threadId,
      receivedAt,
    });
    this.knownThreads.set(threadId, {
      peer: input.to,
      updatedAt: receivedAt,
    });

    return { id };
  }

  async poll(input?: { since?: string; limit?: number }): Promise<AgentMessage[]> {
    const sinceValue = input?.since ? new Date(input.since).getTime() : 0;
    return this.queue
      .filter((message) => new Date(message.receivedAt).getTime() >= sinceValue)
      .slice(0, input?.limit ?? 25);
  }

  async listThreads(limit = 100): Promise<Array<{ id: string; peer?: string; updatedAt?: string }>> {
    return Array.from(this.knownThreads.entries())
      .map(([id, value]) => ({
        id,
        peer: value.peer,
        updatedAt: value.updatedAt,
      }))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, limit);
  }
}

export class XmtpMessagingTransport implements MessagingTransport {
  readonly name = "xmtp-native";
  private readonly account: SignerAccount;
  private readonly env: "local" | "dev" | "production";
  private readonly dbPath?: string | null;
  private client?: Client;

  constructor(options: XmtpMessagingTransportOptions) {
    this.account = options.account;
    this.env = options.env ?? "dev";
    this.dbPath = options.dbPath;
  }

  async send(input: { to: string; content: string; threadId?: string }): Promise<{ id: string }> {
    const client = await this.getClient();
    const dm = isHexAddress(input.to)
      ? await client.conversations.createDmWithIdentifier(toEthereumIdentifier(input.to))
      : await client.conversations.createDm(input.to);
    const id = await dm.sendText(input.content);
    return { id };
  }

  async poll(input?: { since?: string; limit?: number }): Promise<AgentMessage[]> {
    const client = await this.getClient();
    await client.conversations.syncAll();
    const conversations = await client.conversations.list({
      limit: input?.limit ?? 50,
    });
    const since = input?.since ? new Date(input.since).getTime() : 0;
    const outbound: AgentMessage[] = [];

    for (const conversation of conversations) {
      const messages = await conversation.messages({ limit: input?.limit ?? 50 });
      for (const message of messages) {
        const receivedAt = message.sentAt.toISOString();
        if (new Date(receivedAt).getTime() < since) {
          continue;
        }

        const content = toMessageText(message.content);
        if (!content) {
          continue;
        }

        outbound.push({
          id: message.id,
          from: inboxToHex(message.senderInboxId),
          to: this.account.address,
          content,
          threadId: conversation.id,
          receivedAt,
        });
      }
    }

    return outbound
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, input?.limit ?? 25);
  }

  async listThreads(limit = 100): Promise<Array<{ id: string; peer?: string; updatedAt?: string }>> {
    const client = await this.getClient();
    await client.conversations.syncAll();
    const conversations = await client.conversations.list({ limit });
    return conversations.map((conversation) => ({
      id: conversation.id,
      peer: "peerInboxId" in conversation ? String(conversation.peerInboxId) : undefined,
      updatedAt: conversation.createdAt.toISOString(),
    }));
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const { Client } = await import("@xmtp/node-sdk");

    const signer = {
      type: "EOA" as const,
      signMessage: async (message: string): Promise<Uint8Array> => {
        const signatureHex = await this.account.signMessage({ message });
        return hexToBytes(signatureHex);
      },
      getIdentifier: (): Identifier => toEthereumIdentifier(this.account.address),
    };

    this.client = await Client.create(signer, {
      env: this.env,
      dbPath: this.dbPath,
      appVersion: "aethernet/0.1.0",
    });
    return this.client;
  }
}

function toEthereumIdentifier(address: string): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: 0,
  } as Identifier;
}

function isHexAddress(value: string): value is HexAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function toMessageText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!content || typeof content !== "object") {
    return null;
  }
  const maybe = content as { text?: string };
  return typeof maybe.text === "string" ? maybe.text : null;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(clean, "hex"));
}

function inboxToHex(inbox: string): HexAddress {
  const hash = Buffer.from(inbox).toString("hex").slice(0, 40).padEnd(40, "0");
  return `0x${hash}` as HexAddress;
}
