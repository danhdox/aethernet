# Skill Specification (v1)

## Directory layout

Each skill lives under:

`~/.aethernet/skills/<skill-id>/`

Required files:

- `SKILL.md`
- `manifest.json`

## `manifest.json` contract

```json
{
  "id": "web3.read",
  "name": "Web3 Read",
  "description": "Read-only chain-aware reasoning skill",
  "version": "1.0.0",
  "enabled": true,
  "capabilities": ["chain_selection", "identity_context"],
  "toolSources": ["internal.runtime"]
}
```

Required fields: `id`, `name`, `description`, `version`.

## Loader behavior

- Missing `manifest.json` or `SKILL.md`: skill ignored.
- Invalid manifest JSON: skill disabled and skipped.
- Broken one skill must not crash runtime.
- Enabled skill set comes from runtime state (`enabled_skill_ids` KV).

## Lifecycle

1. Install files in skills directory.
2. Validate manifest shape.
3. Toggle with CLI/API:
   - `aethernet skills list`
   - `aethernet skills enable <id>`
   - `aethernet skills disable <id>`
4. Runtime picks up on next turn.
