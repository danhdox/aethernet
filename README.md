# Aethernet

Wallet-native autonomous agent runtime with Web3 primitives and extension-ready tooling.

## GA v1.0.0

Core capabilities:

- Autonomous think/decide/act loop with fail-closed guardrails.
- OpenAI-first pluggable brain runtime.
- Skills framework (`SKILL.md + manifest.json`).
- Structured memory (`turns`, `memory_facts`, `memory_episodes`).
- Incident taxonomy, redacted telemetry, and alert thresholds.
- Web3 surface: ERC-8004 identity/reputation, SIWA/ERC-8128 auth, x402, messaging, replication.

## Quick start

```bash
pnpm install
pnpm -r build
cp .env.example .env
node packages/cli/dist/index.js run
```

`run` bootstraps onboarding automatically when config is missing/incomplete.

## Runtime provider modes

- `selfhost`
- `kubernetes`
- `api`
- `in-memory`

See deployment assets in `deploy/` and `docs/PROVIDER_CONFIG_MATRIX.md`.

## Key CLI commands

- `aethernet run --daemon`
- `aethernet run --once`
- `aethernet status`
- `aethernet skills list|enable|disable`
- `aethernet memory facts|episodes`
- `aethernet tools sources`
- `aethernet config validate`

## Release docs

See the full docs index: `docs/README.md`.
