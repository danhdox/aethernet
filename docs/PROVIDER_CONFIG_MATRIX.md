# Provider Deployment Matrix (v1.0.0)

## Supported modes

| Provider | Runtime setting | Deployment asset | Recommended use | Required config |
| --- | --- | --- | --- | --- |
| selfhost | `AETHERNET_PROVIDER=selfhost` | `deploy/selfhost/docker-compose.yml` | single-node production | `AETHERNET_HOME`, `AETHERNET_OPENAI_API_KEY`, wallet passphrase on first boot |
| kubernetes | `AETHERNET_PROVIDER=kubernetes` | `deploy/kubernetes/aethernet-deployment.yaml` + `deploy/kubernetes/aethernet-service.yaml` | managed cluster staging/prod | `aethernet-config` ConfigMap + `aethernet-secrets` Secret |
| api | `AETHERNET_PROVIDER=api` | `deploy/api/provider-config.example.json` | external compute provider integration | `AETHERNET_PROVIDER_API_URL`, `AETHERNET_PROVIDER_API_KEY` |
| in-memory | `AETHERNET_PROVIDER=in-memory` | `deploy/in-memory/run-local.sh` | local smoke and development | no external provider credentials |

## Configuration notes

- `api` mode is hard-fail without `AETHERNET_PROVIDER_API_KEY`.
- External tool sources stay disabled unless explicitly enabled in config and routed through `readonly_api`.
- Kubernetes rollout should pin image tags (no floating latest tags in production).
- Selfhost mode should persist `~/.aethernet` on durable storage.
