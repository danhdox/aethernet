# Temporary Feature State (2026-02-18)

## Status

This repository is in a **temporary production-hardening state** for Final MVP completion.

Current temporary state:

- Encrypted wallet custody is now default (`wallet.enc.json`), with unlock sessions, lock, and passphrase rotation.
- Runtime now records survival snapshots and heartbeat runs for unsupervised operation controls.
- Protected routes enforce SIWA receipt validation and request-bound ERC-8128 envelope checks (nonce, timestamp, signature, replay guard).
- Chain profiles now include multi-chain feature support matrices and RPC fallback candidates.
- Replication now creates child wallets, persists lineage links, and triggers provider funding hooks.
- Provider runtime is cloud-agnostic by default (`selfhost` provider), now extended with `kubernetes` and existing Conway compatibility.

## Why This State Exists

The project is shifting from scaffolding toward a deployable sovereign runtime. This temporary state prioritizes security and operational correctness while completing the remaining parity gaps.

## What Is Considered Stable

- Encrypted keystore lifecycle: setup, unlock, lock, rotate.
- SIWA nonce issuance and verification with nonce consumption persistence.
- ERC-8128 request-bound replay protection on protected endpoints.
- x402 facilitator-backed paid endpoint contract (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`).
- Child spawn/status/stop/resume/delete lifecycle with lineage persistence.
- Kubernetes provider path (`AETHERNET_PROVIDER=kubernetes`) for deployment on Kubernetes clusters.

## Exit Criteria For This Temporary State

- Native XMTP message flow is running with real inbox traffic in daemon mode (not only local fallback).
- x402 outbound and inbound flows are validated against live facilitator endpoints in target environment.
- Startup fail-closed checks are exercised in production deploy path (constitution hash, keystore, provider health, DB schema).
- Self-mod rollback path is fully exercised with immutable-path rejection and operator recovery workflows.
- Kubernetes deployment flow is ready for production runbooks (`kubectl`-based lifecycle operations).

## Hard Stop

As of 2026-02-18, this temporary state is the hard stop for feature implementation:

- all Final MVP feature surfaces are in place,
- protocol/security rails are integrated,
- runtime replication and self-mod controls are enforced,
- no additional feature commits are required to complete the implementation phase.

Completion note:

- Hard stop mode is feature-frozen.
- New feature work now requires an explicit scope update and a new temporary-state note in this file.

Future work should be explicitly scoped to:

- environment and provider operations tuning,
- monitoring/alerting hardening,
- and production credential/secret lifecycle procedures.
