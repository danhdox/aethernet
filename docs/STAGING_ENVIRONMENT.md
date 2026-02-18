# Staging Environment + Secret Management

## Target profile

- Provider: `kubernetes`
- Namespace: `aethernet-staging`
- Secret backend: Kubernetes Secrets + external secret manager sync
- Alert route: `db` (default) or webhook for staging pager

## Setup sequence

1. Create namespace.
2. Apply `deploy/kubernetes/aethernet-configmap.yaml` (staging overrides).
3. Create secret from `deploy/kubernetes/aethernet-secrets.example.yaml`.
4. Apply:
   - `deploy/kubernetes/aethernet-deployment.yaml`
   - `deploy/kubernetes/aethernet-service.yaml`
5. Validate readiness endpoint `/v1/agent/ready`.

Shortcut:

```bash
scripts/staging/bootstrap-k8s.sh deploy/kubernetes/aethernet-secrets.example.yaml
```

## Secret handling policy

- Never commit real values to git.
- Rotate OpenAI key + wallet passphrase on every staging reset.
- Restrict secret read RBAC to runtime service account only.
- Mount secrets as env vars only; no plaintext files in image layers.

## Required staging checks

- `/v1/agent/health` returns `ok=true`.
- Wallet keystore stored encrypted.
- Runtime incidents show no repeated critical failures before soak start.
