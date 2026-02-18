#!/usr/bin/env bash
set -euo pipefail

TURNS="${1:-50}"
SOAK_HOME="${AETHERNET_SOAK_HOME:-/tmp/aethernet-staging-soak}"
PASSPHRASE="${AETHERNET_SOAK_PASSPHRASE:-Staging#Passphrase123}"
REPORT_PATH="${AETHERNET_SOAK_REPORT_PATH:-/tmp/aethernet-staging-soak-report.json}"

rm -rf "$SOAK_HOME"

node --input-type=module -e "
  import { createDefaultConfig, writeConfig, ensureWallet } from './packages/core-runtime/dist/index.js';
  const env = { ...process.env, AETHERNET_HOME: '$SOAK_HOME', AETHERNET_PROVIDER: 'in-memory', AETHERNET_XMTP_ENABLED: 'false' };
  const config = createDefaultConfig(env);
  config.providerName = 'in-memory';
  config.tooling.allowExternalSources = false;
  config.alerting.route = 'db';
  writeConfig(config);
  ensureWallet(config, { passphrase: '$PASSPHRASE' });
"

for i in $(seq 1 "$TURNS"); do
  AETHERNET_HOME="$SOAK_HOME" \
  AETHERNET_PROVIDER="in-memory" \
  AETHERNET_XMTP_ENABLED="false" \
  AETHERNET_WALLET_PASSPHRASE="$PASSPHRASE" \
  node packages/cli/dist/index.js run --once >/dev/null || true
done

AETHERNET_HOME="$SOAK_HOME" \
AETHERNET_PROVIDER="in-memory" \
node packages/cli/dist/index.js status > "$REPORT_PATH"

echo "Soak report written to: $REPORT_PATH"
