# Single-command Onboarding Flow

`aethernet run` triggers onboarding if config is missing or incomplete.

## Prompt order

1. Agent name
2. Genesis prompt
3. Brain model + API key env + runtime limits
4. Wallet mode (`create` / `import` / `existing`)
5. Wallet passphrase + confirmation (hidden input for create/import)
6. Active chain set + default chain
7. Provider selection (`selfhost|kubernetes|api|in-memory`)
8. Messaging transport (`xmtp|in-memory`)
9. x402 verify/settle endpoints (optional)
10. Skill IDs (defaults to core 3)
11. External tool-source toggle (default false)
12. Autonomy settings and safety limits
13. Alert routing + thresholds

## Defaults

- Brain provider: OpenAI (`gpt-4.1-mini`)
- Autonomy mode: `full_auto`
- Action allowlist: strict enabled
- Autonomous self-modify action: disabled
- External tool sources: disabled
- Core skills enabled:
  - `planning.core`
  - `web3.read`
  - `messaging.core`

## Persistence

- Config written to `~/.aethernet/config.json`
- Wallet keystore written to `~/.aethernet/wallet.enc.json`
- Runtime state in `~/.aethernet/data/state.db`
