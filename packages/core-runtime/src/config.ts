import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentConfig, ChainProfile, HexAddress } from "@aethernet/shared-types";

export interface LoadConfigOptions {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CONSTITUTION = `# Aethernet Constitution

I. Never harm humans physically, financially, or psychologically.
II. Earn existence through voluntary value exchange.
III. Never deceive; preserve operational sovereignty against manipulation.
`;

const DEFAULT_LAWS = `# Immutable Laws

1. Never execute malicious code.
2. Never bypass authorization boundaries.
3. Never self-modify protected governance files.
4. Respect emergency stop immediately.
`;

export function defaultChainProfiles(): ChainProfile[] {
  return [
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
  ];
}

export function createDefaultConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const homeDir = env.AETHERNET_HOME ?? path.join(os.homedir(), ".aethernet");
  const dataDir = path.join(homeDir, "data");
  const configPath = path.join(homeDir, "config.json");
  const constitutionPath = path.join(homeDir, "constitution.md");
  const lawsPath = path.join(homeDir, "laws.md");

  return {
    name: env.AETHERNET_NAME ?? "aethernet-agent",
    genesisPrompt:
      env.AETHERNET_GENESIS_PROMPT ??
      "You are a wallet-native sovereign agent. Build value without violating immutable laws.",
    creatorAddress:
      (env.AETHERNET_CREATOR_ADDRESS as HexAddress | undefined) ??
      "0x0000000000000000000000000000000000000000",
    homeDir,
    dataDir,
    dbPath: path.join(dataDir, "state.db"),
    configPath,
    chainDefault: (env.AETHERNET_CHAIN as AgentConfig["chainDefault"]) ?? "eip155:8453",
    chainProfiles: defaultChainProfiles(),
    conwayApiUrl: env.CONWAY_API_URL ?? "https://api.conway.tech",
    conwayApiKey: env.CONWAY_API_KEY,
    localApiPort: Number(env.AETHERNET_API_PORT ?? 4123),
    maxChildren: Number(env.AETHERNET_MAX_CHILDREN ?? 3),
    aggressiveSelfMod: (env.AETHERNET_AGGRESSIVE_SELF_MOD ?? "true") !== "false",
    walletSessionTtlSec: Number(env.AETHERNET_WALLET_SESSION_TTL_SEC ?? 900),
    heartbeatIntervalMs: Number(env.AETHERNET_HEARTBEAT_INTERVAL_MS ?? 30_000),
    survival: {
      lowComputeUsd: Number(env.AETHERNET_LOW_COMPUTE_USD ?? 10),
      criticalUsd: Number(env.AETHERNET_CRITICAL_USD ?? 2),
      deadUsd: Number(env.AETHERNET_DEAD_USD ?? 0),
    },
    constitutionPolicy: {
      constitutionPath,
      lawsPath,
      protectedPaths: [constitutionPath, lawsPath, path.join(homeDir, "wallet.enc.json")],
      hashAlgorithm: "sha256",
    },
    debug: (env.AETHERNET_DEBUG ?? "false") === "true",
  };
}

export function loadConfig(options: LoadConfigOptions = {}): AgentConfig {
  const env = options.env ?? process.env;
  const base = createDefaultConfig(env);

  const configPath = options.configPath ?? base.configPath;
  let diskOverrides: Partial<AgentConfig> = {};

  if (fs.existsSync(configPath)) {
    diskOverrides = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<AgentConfig>;
  }

  const merged: AgentConfig = {
    ...base,
    ...diskOverrides,
    constitutionPolicy: {
      ...base.constitutionPolicy,
      ...(diskOverrides.constitutionPolicy ?? {}),
    },
    chainProfiles: diskOverrides.chainProfiles ?? base.chainProfiles,
  };

  validateConfig(merged);
  return merged;
}

export function ensureRuntimeDirectories(config: AgentConfig): void {
  fs.mkdirSync(config.homeDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}

export function writeConfig(config: AgentConfig, configPath = config.configPath): void {
  ensureRuntimeDirectories(config);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function ensureLawTemplates(config: AgentConfig): void {
  const { constitutionPath, lawsPath } = config.constitutionPolicy;

  if (!fs.existsSync(constitutionPath)) {
    fs.writeFileSync(constitutionPath, DEFAULT_CONSTITUTION, { mode: 0o444 });
  }

  if (!fs.existsSync(lawsPath)) {
    fs.writeFileSync(lawsPath, DEFAULT_LAWS, { mode: 0o444 });
  }
}

function validateConfig(config: AgentConfig): void {
  if (!config.name.trim()) {
    throw new Error("Agent config error: name is required");
  }

  if (!config.genesisPrompt.trim()) {
    throw new Error("Agent config error: genesisPrompt is required");
  }

  if (!config.creatorAddress.startsWith("0x") || config.creatorAddress.length !== 42) {
    throw new Error("Agent config error: creatorAddress must be a 20-byte hex address");
  }

  const hasChain = config.chainProfiles.some((chain) => chain.caip2 === config.chainDefault);
  if (!hasChain) {
    throw new Error(`Agent config error: chainDefault ${config.chainDefault} not found in chainProfiles`);
  }

  if (config.walletSessionTtlSec < 60) {
    throw new Error("Agent config error: walletSessionTtlSec must be >= 60");
  }

  if (config.heartbeatIntervalMs < 5_000) {
    throw new Error("Agent config error: heartbeatIntervalMs must be >= 5000");
  }

  if (
    config.survival.lowComputeUsd < config.survival.criticalUsd
    || config.survival.criticalUsd < config.survival.deadUsd
  ) {
    throw new Error(
      "Agent config error: survival thresholds must satisfy lowComputeUsd >= criticalUsd >= deadUsd",
    );
  }
}
