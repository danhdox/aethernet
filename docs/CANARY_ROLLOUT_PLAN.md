# Canary Rollout Plan (v1.0.0)

## Rollout stages

1. **Canary 5%** (first 2 hours)
2. **Canary 25%** (next 8 hours)
3. **Canary 100%** (after 24h stable window)

## Metrics to watch

- Critical incident count
- Brain failure streak trend
- Queue depth
- Survival tier transitions
- API readiness/liveness success rates

## Explicit rollback triggers

- Any `SECURITY_POLICY_VIOLATION`
- `dead` survival tier in canary population
- `BRAIN_REQUEST_FAILED` threshold stop observed in canary
- Readiness failures > 2% over 15 min

## Rollback execution

1. Stop new rollout.
2. Repoint traffic to previous stable tag.
3. Restore snapshot pair (`state.db` + `wallet.enc.json`) if required.
4. Open incident and attach telemetry extracts.
