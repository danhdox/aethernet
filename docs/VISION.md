# Vision

Aethernet is a lightweight, wallet-native autonomous runtime where identity, messaging, and value transfer are first-class constraints in agent behavior.

## Product direction

- Keep the core small and deterministic.
- Keep autonomy guarded and auditable.
- Keep extension points explicit (skills + tool sources).
- Keep Web3 primitives native rather than bolted on.

## v1 architecture stance

- Brain: pluggable (OpenAI-first).
- Skills: file-based, human-auditable (`SKILL.md`, `manifest.json`).
- Memory: structured SQLite records without vector DB dependency.
- Tooling: extension-ready registry with secure-by-default external lockout.
