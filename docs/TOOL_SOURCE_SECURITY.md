# Tool-source Extension Contract + Security Model

## Purpose

Tool sources provide extension points for API-based capabilities without shipping a broad tool belt in v1.

## Config contract

`AgentConfig.toolSources[]` entries use:

- `id`
- `name`
- `type` (`internal|api|mcp`)
- `enabled`
- `baseUrl` (for `api`)
- `authEnv` (optional auth token env var)
- `metadata` (optional adapter hints)

Runtime gate:

- `tooling.allowExternalSources` is `false` by default.

## Registry behavior

- Internal source (`internal.runtime`) is always registered.
- External sources (`api`, `mcp`) are blocked unless `tooling.allowExternalSources=true`.
- Disabled sources fail closed.
- Unknown adapters fail closed.

## Invocation contract

Request:

```json
{
  "sourceId": "internal.runtime",
  "toolName": "agent.status",
  "input": {}
}
```

Response:

```json
{
  "ok": true,
  "output": {}
}
```

## Security controls

- Strict action allowlist gates `invoke_tool`.
- External adapter scaffold is read-only (`GET` only).
- Auth tokens come from env, not inline prompt payload.
- Incident and telemetry logging applies secret redaction for auth headers, keys, private key patterns.
- Runtime records blocked external invocation attempts as incidents.
