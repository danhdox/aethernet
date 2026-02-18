# Operator Runbooks

## Emergency stop

1. Trigger:
   - CLI: `aethernet emergency-stop "reason"`
   - API: `POST /v1/agent/stop`
2. Verify state:
   - `aethernet status` -> `emergencyStop=true`
3. Resume only after issue triage:
   - CLI: `aethernet emergency-clear`

## Key rotation

### Wallet passphrase rotation

`aethernet wallet rotate --old-passphrase <old> --new-passphrase <new>`

### API key rotation

1. Update secret manager entry.
2. Restart runtime process.
3. Validate with `/v1/agent/ready`.

## Wallet recovery

1. Restore encrypted wallet file (`wallet.enc.json`) from backup.
2. Set correct passphrase env for unlock.
3. Verify address:
   - `aethernet wallet`
4. Validate identity mapping via `aethernet status`.

## Runtime rollback

### Self-mod rollback

- `aethernet` API/CLI rollback endpoint (path-based rollback point lookup)

### Release rollback

1. Revert to previous release image/tag.
2. Restore `state.db` + `wallet.enc.json` snapshot pair.
3. Restart runtime in read-only validation mode (`run --once --dry`) before daemon.
