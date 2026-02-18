import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ConstitutionPolicy } from "@aethernet/shared-types";
import { AethernetDatabase } from "@aethernet/state";

export function ensureConstitutionFiles(policy: ConstitutionPolicy): void {
  for (const filePath of [policy.constitutionPath, policy.lawsPath]) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Missing required governance file: ${filePath}. Run init to scaffold constitution artifacts.`,
      );
    }

    // Immutable by default.
    fs.chmodSync(filePath, 0o444);
  }
}

export function verifyAndPersistConstitutionHashes(
  db: AethernetDatabase,
  policy: ConstitutionPolicy,
): void {
  for (const filePath of [policy.constitutionPath, policy.lawsPath]) {
    const nextHash = hashFile(filePath, policy.hashAlgorithm);
    const currentHash = db.getConstitutionHash(filePath);

    if (!currentHash) {
      db.upsertConstitutionHash(filePath, nextHash, policy.hashAlgorithm);
      continue;
    }

    if (currentHash !== nextHash) {
      throw new Error(
        `Constitution integrity violation for ${filePath}: expected ${currentHash}, got ${nextHash}`,
      );
    }
  }
}

export function isProtectedPath(targetPath: string, policy: ConstitutionPolicy): boolean {
  const normalized = path.resolve(targetPath);
  return policy.protectedPaths
    .map((value) => path.resolve(value))
    .some((protectedPath) => normalized === protectedPath || normalized.startsWith(`${protectedPath}${path.sep}`));
}

export function hashFile(filePath: string, algorithm: "sha256"): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash(algorithm).update(content).digest("hex");
}
