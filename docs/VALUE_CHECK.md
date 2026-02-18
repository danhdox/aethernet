# Value Check: Final MVP Hardening Shift

## Temporary Feature State Note

This value check is scoped to the current temporary production-hardening state in `docs/FEATURE_STATE.md`.

## Decision Under Review

Adopt wallet-first production hardening now (encrypted custody, stricter request auth, cloud-agnostic runtime defaults, and child lineage controls) instead of deferring these to post-MVP.

## Value Summary

This shift is high-value because it prevents false autonomy claims and unsafe defaults.

Before:

- Wallet custody was not consistently encrypted-first.
- Protected requests were not strongly request-bound/non-replayable.
- Child runtime lifecycle and lineage guarantees were partial.
- Runtime was less explicit about provider portability and health reporting.

After:

- Encrypted keystore + lock/unlock/rotate controls are first-class.
- Protected endpoints require SIWA receipt + ERC-8128 request envelope checks.
- Replication creates unique child wallets with lineage tracking and funding hooks.
- `selfhost` provider is now a first-class default path, with Conway compatibility intact.

## Evidence

Observed during direct CLI/runtime feature checks:

- setup/init creates encrypted wallet metadata and state records
- wallet lock/unlock/rotate lifecycle returns deterministic command responses
- run loop executes with survival snapshots and heartbeat records
- child spawn/status operations persist lineage records and child-specific addresses
- emergency stop/clear transitions are persisted and visible in status output

## Tradeoff

- More strict auth requirements can break permissive clients until they send full request envelopes.
- Native XMTP and live facilitator integrations still need real-environment hardening to complete the full production bar.

## Recommendation

Keep this shift. It materially increases real-world safety, operability, and parity with the sovereign-runtime vision.

Hard stop confirmation:

- Decision is locked as of 2026-02-18.  
- No further feature additions are planned without a new scoped review and updated temporary feature state.
