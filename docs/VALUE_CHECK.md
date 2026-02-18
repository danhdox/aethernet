# Value Check (v1.0.0)

## Decision

Ship a production-hardened autonomous core before adding broad external tooling.

## Why this is the right tradeoff

- Reduces failure blast radius by keeping action surface constrained.
- Preserves future API-tool extension path via registry contracts.
- Prioritizes real operator safety (alerts, incident codes, passphrase hardening, fail-close behavior).

## Evidence in this release

- Config validation is strict and fail-fast.
- Brain output malformed responses are blocked from action execution.
- Action execution is allowlisted and chain-gated.
- Logs/telemetry redact secret-shaped content.
- Staging soak demonstrated alert + threshold behavior.

## Conclusion

This release is a production-ready base for on-chain autonomy with controlled extensibility.
