# Aethernet GA Release Notes — v1.0.0

## Highlights

- Hard removal of legacy provider naming.
- Autonomous think/decide/act loop with fail-closed brain validation.
- OpenAI-first pluggable brain adapter with timeout/retry/backoff controls.
- Skill framework with `SKILL.md + manifest.json`.
- Structured memory layers (`turns`, `memory_facts`, `memory_episodes`).
- Tool-source extension registry with external sources disabled by default.
- Structured incident codes + telemetry + alert thresholds.

## Breaking changes

- Legacy provider identifiers removed.
- Provider env/config contract moved to `api` naming.
- Startup config validation is strict and fail-fast.

## Operational additions

- Single-command onboarding (`aethernet run` bootstraps setup).
- New CLI:
  - `aethernet skills ...`
  - `aethernet memory ...`
  - `aethernet tools ...`
  - `aethernet config validate`
- Local API:
  - skills/memory endpoints
  - tool source and invocation endpoints
  - enriched alerts and metrics endpoints

## Upgrade references

- Scope freeze: `docs/RELEASE_V1_SCOPE.md`
- Migration notes: `docs/BREAKING_CHANGE_MIGRATION.md`
- Rollout plan: `docs/CANARY_ROLLOUT_PLAN.md`
