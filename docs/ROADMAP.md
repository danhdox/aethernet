# Roadmap

## Temporary Feature State Note

As of 2026-02-18, we are prioritizing Final MVP production hardening over feature breadth.

Current temporary state also includes:

- Enforcing SIWA/ERC-8128 verification on protected runtime APIs and child lifecycle endpoints.
- Encrypted keystore lifecycle controls (lock/unlock/rotate).
- Cloud-agnostic provider runtime (`selfhost`, `kubernetes`, `conway`) with in-memory fallback.
- Operational child lifecycle controls (`status` + `stop` + `resume` + `delete`) through CLI and local API.

## Near-Term

1. Harden native XMTP operations in daemon mode against real inbox traffic.
2. Validate x402 facilitator profiles against staging/production endpoints.
3. Complete self-mod rollback operator-facing controls.
4. Add deterministic startup failure signaling to deployment probes.
5. Add provider event/incident alerts for runbook-friendly operations.

## Hard Stop

The implementation hard stop is reached when this roadmap is no longer adding protocol/surface area and only deployment tuning remains.  
At that point, do not expand feature scope; execute environment hardening, runbook updates, and SRE integration only.

Current status:

- Hard stop is active for feature implementation as of 2026-02-18.
- Immediate remaining work is deployment hardening and operational runbook completion only.

## Mid-Term

1. Expand survival-tier economics with live balance-derived thresholds.
2. Add parent-child command channels over XMTP with richer lineage events.
3. Add keystore recovery workflows and key escrow integration options.

## Long-Term Vision Alignment

The project remains focused on a wallet-centric sovereign runtime with identity, auth, payments, communication, and replication integrated into one onchain agentic economy stack.
