# Staging Soak Report (v1.0.0 candidate)

## Execution details

- Date: February 18, 2026
- Environment: local staging profile (`AETHERNET_PROVIDER=in-memory`)
- Home dir: `/tmp/aethernet-staging-soak`
- Command: `scripts/staging/soak-local.sh 12`
- Report output: `/tmp/aethernet-staging-soak-report.json`
- Turns requested: 12

## Observed result

- 4 turns completed before brain-failure threshold stop.
- Fail-safe triggered as expected after repeated malformed brain output.
- Runtime produced critical alerts and incidents with structured codes.

## Incident summary

- `BRAIN_OUTPUT_MALFORMED` (error): repeated when API key was intentionally missing.
- `ALERT_TRIGGERED` (critical): threshold breach for critical incidents and brain failure streak.
- `BRAIN_REQUEST_FAILED` (critical): stop threshold reached (`12/5`).

## Triage outcome

1. **Expected behavior confirmed**: fail-closed + threshold stop worked.
2. **Operator action required for real staging**: set valid `AETHERNET_OPENAI_API_KEY`.
3. **Pre-GA gate**: rerun soak with valid key and target `0` critical incidents for 24h window.
