import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { AgentRegistryRef, ChainProfile, HexAddress } from "@aethernet/shared-types";

const IDENTITY_ABI = parseAbi([
  "function register(string agentURI) external returns (uint256 agentId)",
  "function updateAgentURI(uint256 agentId, string newAgentURI) external",
  "function agentURI(uint256 agentId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
]);

const REPUTATION_ABI = parseAbi([
  "function leaveFeedback(uint256 agentId, uint8 score, string comment) external",
]);

export class Erc8004Client {
  readonly profile: ChainProfile;

  constructor(profile: ChainProfile) {
    this.profile = profile;
  }

  async registerAgent(account: PrivateKeyAccount, agentURI: string): Promise<AgentRegistryRef & { txHash: string }> {
    ensureFeatureSupported(this.profile, "identity", "ERC8004_IDENTITY_UNSUPPORTED");
    const rpcUrls = rpcCandidates(this.profile);
    let lastError: unknown;

    for (const rpcUrl of rpcUrls) {
      try {
        const chain = toViemChain(this.profile, rpcUrl);
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });

        const txHash = await walletClient.writeContract({
          address: this.profile.identityRegistry as Address,
          abi: IDENTITY_ABI,
          functionName: "register",
          args: [agentURI],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const agentId = extractAgentIdFromLogs(receipt.logs);

        return {
          txHash,
          agentId,
          chainId: this.profile.chainId,
          registryAddress: this.profile.identityRegistry,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw buildDeterministicRpcError(
      "ERC8004_REGISTER_FAILED",
      rpcUrls,
      lastError,
    );
  }

  async updateAgentURI(
    account: PrivateKeyAccount,
    agentId: number,
    newAgentURI: string,
  ): Promise<{ txHash: string }> {
    ensureFeatureSupported(this.profile, "identity", "ERC8004_IDENTITY_UNSUPPORTED");
    const rpcUrls = rpcCandidates(this.profile);
    let lastError: unknown;

    for (const rpcUrl of rpcUrls) {
      try {
        const chain = toViemChain(this.profile, rpcUrl);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });

        const txHash = await walletClient.writeContract({
          address: this.profile.identityRegistry as Address,
          abi: IDENTITY_ABI,
          functionName: "updateAgentURI",
          args: [BigInt(agentId), newAgentURI],
        });

        return { txHash };
      } catch (error) {
        lastError = error;
      }
    }

    throw buildDeterministicRpcError(
      "ERC8004_UPDATE_FAILED",
      rpcUrls,
      lastError,
    );
  }

  async queryAgent(agentId: number): Promise<{
    agentId: number;
    owner: HexAddress;
    agentURI: string;
  }> {
    ensureFeatureSupported(this.profile, "identity", "ERC8004_IDENTITY_UNSUPPORTED");
    const rpcUrls = rpcCandidates(this.profile);
    let lastError: unknown;

    for (const rpcUrl of rpcUrls) {
      try {
        const chain = toViemChain(this.profile, rpcUrl);
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

        const [owner, agentURI] = await Promise.all([
          publicClient.readContract({
            address: this.profile.identityRegistry as Address,
            abi: IDENTITY_ABI,
            functionName: "ownerOf",
            args: [BigInt(agentId)],
          }),
          publicClient.readContract({
            address: this.profile.identityRegistry as Address,
            abi: IDENTITY_ABI,
            functionName: "agentURI",
            args: [BigInt(agentId)],
          }),
        ]);

        return {
          agentId,
          owner: owner as HexAddress,
          agentURI: agentURI as string,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw buildDeterministicRpcError(
      "ERC8004_QUERY_FAILED",
      rpcUrls,
      lastError,
    );
  }

  async leaveFeedback(
    account: PrivateKeyAccount,
    agentId: number,
    score: number,
    comment: string,
  ): Promise<{ txHash: string }> {
    ensureFeatureSupported(this.profile, "reputation", "ERC8004_REPUTATION_UNSUPPORTED");
    if (!this.profile.reputationRegistry) {
      throw new Error(`ERC8004_REPUTATION_UNSUPPORTED: Chain ${this.profile.chainId} has no reputation registry`);
    }

    const rpcUrls = rpcCandidates(this.profile);
    let lastError: unknown;

    for (const rpcUrl of rpcUrls) {
      try {
        const chain = toViemChain(this.profile, rpcUrl);
        const walletClient = createWalletClient({
          account,
          chain,
          transport: http(rpcUrl),
        });

        const txHash = await walletClient.writeContract({
          address: this.profile.reputationRegistry as Address,
          abi: REPUTATION_ABI,
          functionName: "leaveFeedback",
          args: [BigInt(agentId), score, comment],
        });

        return { txHash };
      } catch (error) {
        lastError = error;
      }
    }

    throw buildDeterministicRpcError(
      "ERC8004_FEEDBACK_FAILED",
      rpcUrls,
      lastError,
    );
  }
}

function toViemChain(profile: ChainProfile, rpcUrl = profile.rpcUrl) {
  if (profile.chainId === 8453) {
    return base;
  }

  if (profile.chainId === 84532) {
    return baseSepolia;
  }

  return defineChain({
    id: profile.chainId,
    name: profile.name,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
      public: {
        http: [rpcUrl],
      },
    },
  });
}

function ensureFeatureSupported(
  profile: ChainProfile,
  feature: "identity" | "reputation",
  code: string,
): void {
  const supported = profile.supports?.[feature];
  if (supported === false) {
    throw new Error(`${code}: ${profile.caip2} does not support ${feature}`);
  }
}

function rpcCandidates(profile: ChainProfile): string[] {
  return [profile.rpcUrl, ...(profile.rpcFallbackUrls ?? [])];
}

function buildDeterministicRpcError(
  code: string,
  rpcUrls: string[],
  cause: unknown,
): Error {
  const details = cause instanceof Error ? cause.message : String(cause);
  return new Error(`${code}: all RPC endpoints failed (${rpcUrls.join(", ")}): ${details}`);
}

function extractAgentIdFromLogs(logs: Array<{ topics: readonly HexAddress[] | readonly string[] }>): number {
  for (const log of logs) {
    if (log.topics.length < 4) {
      continue;
    }

    const tokenIdHex = log.topics[3];
    if (!tokenIdHex) {
      continue;
    }

    try {
      return Number(BigInt(tokenIdHex));
    } catch {
      continue;
    }
  }

  throw new Error("Could not determine ERC-8004 agentId from transaction logs");
}
