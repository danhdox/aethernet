import type { SkillRecord } from "@aethernet/shared-types";
import { MESSAGING_CORE_SKILL } from "./core/messaging.js";
import { PLANNING_CORE_SKILL } from "./core/planning.js";
import { WEB3_READ_SKILL } from "./core/web3-read.js";

export function coreSkills(): SkillRecord[] {
  return [PLANNING_CORE_SKILL, WEB3_READ_SKILL, MESSAGING_CORE_SKILL];
}
