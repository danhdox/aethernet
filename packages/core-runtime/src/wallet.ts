import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, HexAddress, WalletKeystoreMeta } from "@aethernet/shared-types";
import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const CIPHER_ALGO = "aes-256-gcm";
const KDF_KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_PASSPHRASE_LENGTH = 12;

interface LegacyWalletData {
  privateKey: `0x${string}`;
  address: HexAddress;
  createdAt: string;
}

interface EncryptedWalletData {
  version: 1;
  cipher: "aes-256-gcm";
  kdf: "scrypt";
  saltHex: string;
  ivHex: string;
  tagHex: string;
  ciphertextHex: string;
  address: HexAddress;
  createdAt: string;
  updatedAt: string;
}

export function walletPath(config: AgentConfig): string {
  return path.join(config.homeDir, "wallet.enc.json");
}

export function legacyWalletPath(config: AgentConfig): string {
  return path.join(config.homeDir, "wallet.json");
}

export function walletExists(config: AgentConfig): boolean {
  return fs.existsSync(walletPath(config)) || fs.existsSync(legacyWalletPath(config));
}

export function ensureWallet(
  config: AgentConfig,
  options: { passphrase?: string } = {},
): {
  address: HexAddress;
  isNew: boolean;
  migratedLegacy: boolean;
} {
  fs.mkdirSync(config.homeDir, { recursive: true, mode: 0o700 });
  const encryptedPath = walletPath(config);
  const legacyPath = legacyWalletPath(config);

  if (fs.existsSync(encryptedPath)) {
    const encrypted = readEncryptedWallet(config);
    if (options.passphrase) {
      decryptWalletAccount(config, options.passphrase);
    }
    return {
      address: encrypted.address,
      isNew: false,
      migratedLegacy: false,
    };
  }

  if (fs.existsSync(legacyPath)) {
    if (!options.passphrase) {
      throw new Error(
        `Legacy wallet detected at ${legacyPath}. Set AETHERNET_WALLET_PASSPHRASE to migrate to encrypted keystore.`,
      );
    }
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as LegacyWalletData;
    const account = privateKeyToAccount(legacy.privateKey);
    writeEncryptedWallet(
      config,
      legacy.privateKey,
      account.address,
      legacy.createdAt,
      options.passphrase,
    );
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);
    return {
      address: account.address,
      isNew: false,
      migratedLegacy: true,
    };
  }

  if (!options.passphrase) {
    throw new Error(
      "Wallet passphrase required for first-time setup. Set AETHERNET_WALLET_PASSPHRASE or use wallet unlock/rotate flow.",
    );
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  writeEncryptedWallet(
    config,
    privateKey,
    account.address,
    new Date().toISOString(),
    options.passphrase,
  );

  return {
    address: account.address,
    isNew: true,
    migratedLegacy: false,
  };
}

export function decryptWalletAccount(config: AgentConfig, passphrase: string): PrivateKeyAccount {
  const encrypted = readEncryptedWallet(config);
  const privateKey = decryptPrivateKey(encrypted, passphrase);
  return privateKeyToAccount(privateKey);
}

export function loadWalletAccount(config: AgentConfig): PrivateKeyAccount {
  const passphrase = process.env.AETHERNET_WALLET_PASSPHRASE;
  if (!passphrase) {
    throw new Error("Wallet is encrypted. Set AETHERNET_WALLET_PASSPHRASE or run wallet unlock.");
  }
  return decryptWalletAccount(config, passphrase);
}

export function rotateWalletPassphrase(
  config: AgentConfig,
  oldPassphrase: string,
  newPassphrase: string,
): WalletKeystoreMeta {
  if (oldPassphrase === newPassphrase) {
    throw new Error("New wallet passphrase must differ from the old passphrase.");
  }
  assertPassphraseStrength(newPassphrase);
  const account = decryptWalletAccount(config, oldPassphrase);
  const privateKey = decryptWalletPrivateKey(config, oldPassphrase);
  const encrypted = readEncryptedWallet(config);
  writeEncryptedWallet(
    config,
    privateKey,
    account.address,
    encrypted.createdAt,
    newPassphrase,
  );
  return readWalletMeta(config);
}

export function importWalletPrivateKey(
  config: AgentConfig,
  privateKey: `0x${string}`,
  passphrase: string,
  options: { allowOverwrite?: boolean } = {},
): WalletKeystoreMeta {
  if (!options.allowOverwrite && walletExists(config)) {
    throw new Error("A wallet already exists. Rotate passphrase or remove existing wallet before importing.");
  }
  if (!privateKey.startsWith("0x") || privateKey.length !== 66) {
    throw new Error("Invalid private key format. Expected 32-byte 0x-prefixed hex string.");
  }
  assertPassphraseStrength(passphrase);

  const account = privateKeyToAccount(privateKey);
  writeEncryptedWallet(
    config,
    privateKey,
    account.address,
    new Date().toISOString(),
    passphrase,
  );

  return readWalletMeta(config);
}

export function readWalletMeta(config: AgentConfig): WalletKeystoreMeta {
  const encrypted = readEncryptedWallet(config);
  return {
    address: encrypted.address,
    path: walletPath(config),
    encrypted: true,
    createdAt: encrypted.createdAt,
    updatedAt: encrypted.updatedAt,
  };
}

export function getWalletAddress(config: AgentConfig): HexAddress {
  const encrypted = readEncryptedWallet(config);
  return encrypted.address;
}

function readEncryptedWallet(config: AgentConfig): EncryptedWalletData {
  const filePath = walletPath(config);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Encrypted wallet file not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as EncryptedWalletData;
  if (parsed.version !== 1 || parsed.cipher !== "aes-256-gcm" || parsed.kdf !== "scrypt") {
    throw new Error("Unsupported wallet keystore format");
  }
  return parsed;
}

function writeEncryptedWallet(
  config: AgentConfig,
  privateKey: `0x${string}`,
  address: HexAddress,
  createdAt: string,
  passphrase: string,
): void {
  assertPassphraseStrength(passphrase);

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.scryptSync(passphrase, salt, KDF_KEY_LEN);

  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv, { authTagLength: TAG_LEN });
  const encrypted = Buffer.concat([cipher.update(privateKey, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const now = new Date().toISOString();

  const payload: EncryptedWalletData = {
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    saltHex: salt.toString("hex"),
    ivHex: iv.toString("hex"),
    tagHex: tag.toString("hex"),
    ciphertextHex: encrypted.toString("hex"),
    address,
    createdAt,
    updatedAt: now,
  };

  fs.writeFileSync(walletPath(config), JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(walletPath(config), 0o600);
}

function decryptPrivateKey(
  encrypted: EncryptedWalletData,
  passphrase: string,
): `0x${string}` {
  const salt = Buffer.from(encrypted.saltHex, "hex");
  const iv = Buffer.from(encrypted.ivHex, "hex");
  const tag = Buffer.from(encrypted.tagHex, "hex");
  const ciphertext = Buffer.from(encrypted.ciphertextHex, "hex");
  const key = crypto.scryptSync(passphrase, salt, KDF_KEY_LEN);

  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
    if (!plaintext.startsWith("0x") || plaintext.length !== 66) {
      throw new Error("Decrypted wallet private key is invalid");
    }
    return plaintext as `0x${string}`;
  } catch (error) {
    throw new Error(
      `Failed to decrypt wallet. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decryptWalletPrivateKey(config: AgentConfig, passphrase: string): `0x${string}` {
  const encrypted = readEncryptedWallet(config);
  return decryptPrivateKey(encrypted, passphrase);
}

function assertPassphraseStrength(passphrase: string): void {
  if (!passphrase.trim()) {
    throw new Error("Wallet passphrase cannot be empty.");
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Wallet passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }

  const classes = [
    /[a-z]/.test(passphrase),
    /[A-Z]/.test(passphrase),
    /[0-9]/.test(passphrase),
    /[^A-Za-z0-9]/.test(passphrase),
  ].filter(Boolean).length;
  if (classes < 3) {
    throw new Error("Wallet passphrase must include at least 3 character classes (lower, upper, number, symbol).");
  }
}
