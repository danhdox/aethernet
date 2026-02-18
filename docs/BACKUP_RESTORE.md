# Backup and Restore Procedures

## Scope

Back up and restore these files as an atomic set:

- `~/.aethernet/data/state.db`
- `~/.aethernet/wallet.enc.json`
- `~/.aethernet/config.json`

## Backup procedure

1. Stop runtime daemon.
2. Create timestamped snapshot directory.
3. Copy files with permissions preserved.
4. Encrypt snapshot at rest in backup storage.

Example:

```bash
ts=$(date -u +%Y%m%dT%H%M%SZ)
dst="/secure-backups/aethernet/${ts}"
mkdir -p "$dst"
cp -a ~/.aethernet/data/state.db "$dst/"
cp -a ~/.aethernet/wallet.enc.json "$dst/"
cp -a ~/.aethernet/config.json "$dst/"
```

## Restore procedure

1. Stop runtime daemon.
2. Restore matching snapshot set.
3. Enforce file permissions (`600` for wallet/config, `700` for runtime dirs).
4. Start runtime with `aethernet run --once --dry`.
5. If healthy, resume daemon.

## Recovery guardrails

- Never restore `state.db` without matching `wallet.enc.json`.
- Keep at least 7 daily snapshots and 4 weekly snapshots.
- Validate wallet address post-restore before enabling autonomous writes.
