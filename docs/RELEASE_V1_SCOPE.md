# Aethernet v1.0.0 Scope Freeze

Date: 2026-02-18
Status: Frozen
Owner: Aethernet Core

## Release Intent

Ship Aethernet as a production-ready, lightweight autonomous agent runtime with:

- wallet-native identity and custody,
- model-driven autonomous loop with explicit guardrails,
- skills and memory primitives,
- x402 payments, SIWA/ERC-8128 auth, XMTP messaging,
- portable compute providers (`selfhost`, `kubernetes`, `api`, `in-memory`).

## In Scope (v1.0.0)

1. Conway naming removal and `api` provider hard break.
2. Startup validation and fail-fast diagnostics.
3. Brain runtime hardening (timeout, retry/backoff, action limits, malformed output fail-closed).
4. Strict action allowlist + chain capability gating for autonomous actions.
5. Onboarding hardening (wallet create/import and passphrase requirements).
6. Structured memory (`memory_facts`, `memory_episodes`) and operator surfaces.
7. Incident taxonomy, telemetry schema, and alert thresholds/routing.
8. Skill format/tool-extension docs and secure external adapter scaffold.
9. Deployment matrix, staging plan, soak runbook, operator runbooks, backup/restore.
10. Release packaging workflow, canary plan, GA release notes.

## Out of Scope (v1.0.0)

1. Full external tool marketplace.
2. Vector memory/embeddings.
3. REPL shell control plane.
4. New protocol feature expansion beyond current ERC/x402/XMTP rails.

## Acceptance Criteria

1. Workspace builds with `pnpm -r build`.
2. No legacy provider alias references remain in runtime/docs surfaces.
3. Runtime rejects startup with missing required production config and prints structured diagnostics.
4. Runtime enforces autonomous safety limits and records structured incidents for unsafe/malformed actions.
5. Onboarding can create or import wallet with encrypted keystore path only.
6. Skills and memory are manageable via CLI and local API.
7. Alert thresholds are configurable and routed to configured destinations.
8. `.env.example`, runbooks, deployment matrix, staging/soak procedure, and GA release notes are present.

## Change Control

Any additions to v1.0.0 scope require:

1. explicit approval from maintainers,
2. update to this document and `docs/ROADMAP.md`,
3. updated release notes impact statement.
