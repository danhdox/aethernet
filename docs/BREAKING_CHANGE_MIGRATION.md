# Breaking Change Migration (v1.0.0)

## Summary

v1.0.0 removes legacy provider naming and requires the neutral provider contract.

## Required config migration

- Remove legacy provider URL/key fields from `config.json`.
- Add:
  - `providerApiUrl`
  - `providerApiKey` (optional in config, required when `providerName` is `api`)
- Provider selector changed from the legacy alias to `AETHERNET_PROVIDER=api`.

## Required env migration

- Legacy provider URL env var -> `AETHERNET_PROVIDER_API_URL`
- Legacy provider key env var -> `AETHERNET_PROVIDER_API_KEY`

## Minimal `config.json` delta

```json
{
  "providerName": "api",
  "providerApiUrl": "https://compute.example.com",
  "providerApiKey": "env-or-inline-key"
}
```

## Behavioral changes

- Startup now fails fast with structured config diagnostics when required fields are missing.
- Brain output now fails closed when malformed.
- Action execution is strict-allowlist gated.
- External tool sources are disabled by default (`tooling.allowExternalSources=false`).
