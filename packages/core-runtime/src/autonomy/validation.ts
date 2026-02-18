import type { BrainTurnOutput } from "@aethernet/shared-types";

const DEFAULT_ACTION_ALLOWLIST = new Set([
  "send_message",
  "replicate",
  "self_modify",
  "record_fact",
  "record_episode",
  "invoke_tool",
  "sleep",
  "noop",
]);

export interface BrainOutputValidationResult {
  output: BrainTurnOutput;
  malformed: boolean;
  errors: string[];
}

export function validateBrainTurnOutput(
  output: BrainTurnOutput,
  limits: { maxActions: number; maxSleepMs: number },
  options: { strictAllowlist: boolean; allowlist?: Set<string> },
): BrainOutputValidationResult {
  const errors: string[] = [];
  const allowlist = options.allowlist ?? DEFAULT_ACTION_ALLOWLIST;
  const actions = Array.isArray(output.nextActions) ? output.nextActions : [];

  const nextActions = actions.slice(0, Math.max(1, limits.maxActions)).map((action) => ({
    type: action.type,
    reason: action.reason,
    params: action.params && typeof action.params === "object" ? action.params : undefined,
  }));

  const filteredActions = nextActions.filter((action) => {
    if (!allowlist.has(action.type)) {
      errors.push(`action_not_allowed:${action.type}`);
      return false;
    }
    return true;
  });

  const sleepMs = Number.isFinite(Number(output.sleepMs))
    ? Math.max(0, Math.min(Number(output.sleepMs), limits.maxSleepMs))
    : undefined;

  if (typeof output.summary !== "string" || !output.summary.trim()) {
    errors.push("missing_summary");
  }

  if (!Array.isArray(output.nextActions)) {
    errors.push("missing_actions");
  }

  if (output.integrity === "malformed") {
    errors.push("provider_marked_malformed");
  }

  const malformed = options.strictAllowlist
    ? errors.length > 0
    : errors.some((error) => error === "missing_summary" || error === "missing_actions");

  return {
    malformed,
    errors,
    output: {
      summary: output.summary?.trim() || "Autonomous turn completed.",
      nextActions: filteredActions.length ? filteredActions : [{ type: "noop", reason: "no_actions" }],
      memoryWrites: output.memoryWrites,
      sleepMs,
      integrity: malformed ? "malformed" : "ok",
    },
  };
}
