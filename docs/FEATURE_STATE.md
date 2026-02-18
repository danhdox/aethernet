# Feature State (GA v1.0.0)

## Status

GA scope is frozen and release-candidate complete for v1.0.0.

## Implemented in v1.0.0

- Conway naming removed; neutral provider contract is active.
- Single-command onboarding (`aethernet run`) with wallet/network/provider/skills/autonomy prompts.
- OpenAI-first brain provider with timeout/retry/backoff and malformed-output fail-close.
- Autonomous loop with strict allowlist, chain capability gates, and emergency controls.
- Structured memory:
  - short-term turns
  - durable facts (`memory_facts`)
  - episodic outcomes (`memory_episodes`)
- Skill model (`SKILL.md + manifest.json`) + core 3 skills.
- Tool-source extension registry with read-only API adapter scaffold.
- Incident code taxonomy, redacted logging, turn telemetry, and alert routing thresholds.
- Web3 primitives preserved:
  - ERC-8004 identity/reputation
  - SIWA/ERC-8128 auth
  - x402 flows
  - messaging
  - replication lifecycle

## Operational artifacts

- Provider deployment assets: selfhost, kubernetes, api, in-memory.
- Staging runbook + soak report.
- Backup/restore and operator runbooks.
- Canary rollout and GA release notes.
