#!/usr/bin/env bash
set -euo pipefail

export AETHERNET_PROVIDER="in-memory"
export AETHERNET_XMTP_ENABLED="false"
export AETHERNET_ALERT_ROUTE="stdout"

corepack enable >/dev/null 2>&1 || true
pnpm -r build
node packages/cli/dist/index.js run --once
