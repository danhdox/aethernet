import type { SkillRecord } from "@aethernet/shared-types";

export const PLANNING_CORE_SKILL: SkillRecord = {
  id: "planning.core",
  name: "Planning Core",
  description: "Break work into safe, sequential steps with explicit completion checks.",
  version: "1.0.0",
  enabled: true,
  capabilities: ["planning", "task_decomposition"],
  toolSources: [],
  instructions: [
    "Always propose clear next actions before risky operations.",
    "Prefer smaller reversible steps over large batch changes.",
    "Summarize outcomes and blocked conditions at the end of each turn.",
  ].join("\n"),
};
