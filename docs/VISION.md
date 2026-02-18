# Vision

## Temporary Feature State Note

During the current transition, we are intentionally hardening:

- payment truthfulness (x402 verify/settle),
- request identity gates (SIWA/ERC-8128 request-bound verification),
- wallet custody security (encrypted keystore lifecycle),
- child lifecycle controls (spawn/stop/resume/termination) under emergency governance.

## Vision Statement

Aethernet aims to be a wallet-native sovereign agent runtime where identity, authentication, communication, and value exchange are all verifiable and programmable.

## Core Principles

- Wallet at the center.
- Identity and reputation via ERC-8004.
- Auth via SIWA/ERC-8128 signatures.
- Payments via x402 with real settlement guarantees.
- Communication layer abstractions that support agent-to-agent and human-to-agent coordination.
- Immutable constitution and law boundaries over self-mod/autonomy controls.

## Practical Path

The project advances by locking correctness at each boundary before widening autonomy and replication surface area.

Current operational additions:
- Runtime loop now processes inbound messages, tracks survival tiers, and applies bounded self-mod directives.
- Registry, reputation, auth nonce/replay records, and child lineage are persisted in SQLite state.
- Provider abstraction now supports cloud-agnostic execution (`selfhost`, `kubernetes`, `conway`) with production-ready compatibility.

Execution status:

- As of 2026-02-18, the feature implementation pass is at hard stop.
- The next phase is production operations only (hardening and monitoring).
