# Staging Autonomous Soak Runbook

## Objective

Validate autonomous loop stability and alert behavior before canary rollout.

## Procedure

1. Deploy staging with `deploy/kubernetes` manifests and real secrets.
2. Start runtime daemon (`aethernet run --daemon`).
3. Run soak window:
   - minimum duration: 24 hours
   - minimum turns: 2,000
4. Capture:
   - `/v1/agent/metrics`
   - `/v1/agent/alerts`
   - `/v1/agent/health`

Local scripted soak helper:

```bash
scripts/staging/soak-local.sh 200
```

## Pass criteria

- `critical` incidents = 0
- `brainFailures` does not grow across final 200 turns
- queue depth stays below configured threshold
- no emergency-stop activation

## Immediate fail criteria

- any `SECURITY_POLICY_VIOLATION`
- survival tier reaches `dead`
- repeated `BRAIN_REQUEST_FAILED` until threshold stop
