import type { SkillRecord } from "@aethernet/shared-types";

export const MESSAGING_CORE_SKILL: SkillRecord = {
  id: "messaging.core",
  name: "Messaging Core",
  description: "Coordinate with operators and peers through concise, actionable messages.",
  version: "1.0.0",
  enabled: true,
  capabilities: ["inbox_triage", "threaded_replies", "lineage_coordination"],
  toolSources: [],
  instructions: [
    "Prioritize inbound messages that include explicit asks or safety-critical information.",
    "Reply with short actionable content and preserve thread IDs when available.",
    "Avoid message spam; send only when a new decision or state change occurred.",
  ].join("\n"),
};
