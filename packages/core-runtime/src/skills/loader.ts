import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, SkillManifest, SkillRecord } from "@aethernet/shared-types";
import { coreSkills } from "./registry.js";

export function loadSkillRecords(config: AgentConfig, enabledSkillIds?: string[]): SkillRecord[] {
  const enabledSet = new Set(enabledSkillIds ?? config.enabledSkillIds);
  const records = new Map<string, SkillRecord>();

  for (const skill of coreSkills()) {
    records.set(skill.id, {
      ...skill,
      enabled: enabledSet.has(skill.id),
    });
  }

  const root = path.resolve(config.skillsDir);
  if (!fs.existsSync(root)) {
    return Array.from(records.values());
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(root, entry.name);
    const manifestPath = path.join(skillPath, "manifest.json");
    const instructionsPath = path.join(skillPath, "SKILL.md");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(instructionsPath)) {
      continue;
    }

    try {
      const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Partial<SkillManifest>;
      if (!manifestRaw.id || !manifestRaw.name || !manifestRaw.description || !manifestRaw.version) {
        continue;
      }

      const record: SkillRecord = {
        id: manifestRaw.id,
        name: manifestRaw.name,
        description: manifestRaw.description,
        version: manifestRaw.version,
        enabled: enabledSet.has(manifestRaw.id)
          ? true
          : Boolean(manifestRaw.enabled),
        capabilities: Array.isArray(manifestRaw.capabilities) ? manifestRaw.capabilities : [],
        toolSources: Array.isArray(manifestRaw.toolSources) ? manifestRaw.toolSources : [],
        instructions: fs.readFileSync(instructionsPath, "utf-8"),
        sourcePath: skillPath,
      };

      records.set(record.id, record);
    } catch {
      continue;
    }
  }

  return Array.from(records.values());
}

export function ensureSkillDirectory(config: AgentConfig): void {
  fs.mkdirSync(path.resolve(config.skillsDir), { recursive: true, mode: 0o700 });
}
