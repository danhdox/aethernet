import type { ChainProfile } from "@aethernet/shared-types";

export const DEFAULT_CHAIN_PROFILES: ChainProfile[] = [
  {
    chainId: 8453,
    name: "Base",
    caip2: "eip155:8453",
    rpcUrl: "https://mainnet.base.org",
    rpcFallbackUrls: ["https://base-rpc.publicnode.com"],
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    supports: {
      identity: true,
      reputation: true,
      payments: true,
      auth: true,
      messaging: true,
    },
    isTestnet: false,
  },
  {
    chainId: 84532,
    name: "Base Sepolia",
    caip2: "eip155:84532",
    rpcUrl: "https://sepolia.base.org",
    rpcFallbackUrls: ["https://base-sepolia-rpc.publicnode.com"],
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    supports: {
      identity: true,
      reputation: true,
      payments: true,
      auth: true,
      messaging: true,
    },
    isTestnet: true,
  },
  {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    caip2: "eip155:11155111",
    rpcUrl: "https://rpc.sepolia.org",
    rpcFallbackUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    identityRegistry: "0x8004a6090Cd10A7288092483047B097295Fb8847",
    supports: {
      identity: true,
      reputation: false,
      payments: false,
      auth: true,
      messaging: true,
    },
    isTestnet: true,
  },
  {
    chainId: 59141,
    name: "Linea Sepolia",
    caip2: "eip155:59141",
    rpcUrl: "https://rpc.sepolia.linea.build",
    rpcFallbackUrls: ["https://linea-sepolia-rpc.publicnode.com"],
    identityRegistry: "0x8004aa7C931bCE1233973a0C6A667f73F66282e7",
    supports: {
      identity: true,
      reputation: false,
      payments: false,
      auth: true,
      messaging: true,
    },
    isTestnet: true,
  },
  {
    chainId: 80002,
    name: "Polygon Amoy",
    caip2: "eip155:80002",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    rpcFallbackUrls: ["https://polygon-amoy-bor-rpc.publicnode.com"],
    identityRegistry: "0x8004ad19E14B9e0654f73353e8a0B600D46C2898",
    supports: {
      identity: true,
      reputation: false,
      payments: false,
      auth: true,
      messaging: true,
    },
    isTestnet: true,
  },
];

export function findChainProfile(
  chainIdOrCaip2: number | string,
  profiles: ChainProfile[] = DEFAULT_CHAIN_PROFILES,
): ChainProfile {
  const found =
    typeof chainIdOrCaip2 === "number"
      ? profiles.find((profile) => profile.chainId === chainIdOrCaip2)
      : profiles.find((profile) => profile.caip2 === chainIdOrCaip2);

  if (!found) {
    throw new Error(`Unsupported chain profile: ${String(chainIdOrCaip2)}`);
  }

  return found;
}
