import type { SkillRecord } from "@aethernet/shared-types";

export const WEB3_READ_SKILL: SkillRecord = {
  id: "web3.read",
  name: "Web3 Read",
  description: "Use identity, chain profile, and payment state to make on-chain aware decisions.",
  version: "1.0.0",
  enabled: true,
  capabilities: ["chain_selection", "identity_context", "x402_awareness"],
  toolSources: [],
  instructions: [
    "Respect chain feature support before proposing identity or payment operations.",
    "Use x402 and wallet state as first-class constraints when planning actions.",
    "Prefer read/evaluation before irreversible value transfer decisions.",
  ].join("\n"),
};
