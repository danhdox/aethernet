# Roadmap (post-v1.0.0)

## Current phase

v1.0.0 release execution and canary rollout.

## Next priorities

1. Production canary and full rollout completion.
2. 24h staging soak rerun with valid model credentials and zero critical incidents.
3. External tool-source enablement policy by environment (staging/prod separation).
4. Operator dashboard integration over `/v1/agent/metrics` and `/v1/agent/alerts`.

## v1.x targets

- Add explicit allow/deny policy layer per tool source.
- Add production webhook alert integration.
- Expand runbooks with incident drill simulations.

## Out of scope for v1.0.0

- Broad external tool marketplace.
- Vector DB memory layer.
- Rich interactive REPL operator surface.
