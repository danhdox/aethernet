# aethernet

Wallet-centric sovereign agent runtime for the onchain agent economy stack:

- ERC-8004 identity/reputation
- SIWA + ERC-8128 auth
- x402 bidirectional payments
- XMTP-native messaging
- bounded self-modification + replication

## Temporary Feature State (2026-02-18)

Current temporary state is a production-hardening checkpoint for Final MVP scope:

- encrypted keystore (`~/.aethernet/wallet.enc.json`) with lock/unlock/rotate lifecycle
- unsupervised daemon loop with survival tiers and heartbeat persistence
- strict protected-route auth with SIWA receipt validation + request-bound ERC-8128 envelope checks
- multi-chain profile registry with feature support matrix and RPC fallback behavior
- child spawn with unique wallet + lineage + provider funding hook
- startup hard-stop marker is active for this phase (no new feature work without new scope decision)

Reference notes:

- `docs/FEATURE_STATE.md`
- `docs/VALUE_CHECK.md`
- `docs/ROADMAP.md`
- `docs/VISION.md`

## Workspace

- `packages/shared-types` - cross-package contracts
- `packages/provider-interface` - cloud-agnostic provider contract (`selfhost`, `kubernetes`, `conway`, `in-memory`)
- `packages/state` - SQLite schema + repositories
- `packages/core-runtime` - loop, survival, self-mod, constitution/law enforcement
- `packages/protocol-identity` - ERC-8004 identity/reputation + chain profile handling
- `packages/protocol-auth` - SIWA/ERC-8128 auth primitives
- `packages/protocol-payments` - x402 flow + facilitator adapters/profiles
- `packages/protocol-messaging` - XMTP-native + in-memory messaging transports
- `packages/cli` - `aethernet` CLI surface
- `apps/local-api` - local HTTP API surface

## Quick Start

```bash
pnpm install
pnpm build
export AETHERNET_WALLET_PASSPHRASE="change-me"
node packages/cli/dist/index.js setup wizard
node packages/cli/dist/index.js run --once --dry
```

## Runtime Notes

- `aethernet run` defaults to daemon mode unless `--once` is provided.
- `AETHERNET_PROVIDER` selects provider (`selfhost` default, `kubernetes`, `conway`, `in-memory`).
- For paid endpoints (`/v1/x402/protected/*`), set facilitator URLs:

```bash
export AETHERNET_X402_VERIFY_URL="https://your-facilitator.example/verify"
export AETHERNET_X402_SETTLE_URL="https://your-facilitator.example/settle"
export AETHERNET_X402_FACILITATOR_KEY="optional-api-key"
```

### Kubernetes Provider

Use `AETHERNET_PROVIDER=kubernetes` for any-cloud/Kubernetes-first deployment paths.

```bash
export AETHERNET_PROVIDER=kubernetes
export AETHERNET_K8S_NAMESPACE=aethernet
export AETHERNET_K8S_IMAGE=node:20-alpine
export AETHERNET_K8S_POD_PREFIX=aethernet-sandbox
export AETHERNET_K8S_CONTEXT=my-context
export AETHERNET_K8S_KUBECONFIG=~/.kube/config
```

### Hard Stop (Production-Ready Finish Line)

As of this scope pass, the following is the current hard stop boundary:

- wallet-centric identity/auth/payment/messaging/protocol stack is implemented,
- provider abstraction is cloud-agnostic with `selfhost` + `kubernetes` + `conway` + `in-memory`,
- runtime autonomy controls and replication controls are implemented,
- CLI/API command surface and data model are in place.

No additional implementation pieces are required to claim this repository’s Final MVP scope completion in this run.  
The hard stop is: **no new feature work should be started without a new explicit scope decision**.

Completion evidence for feature hard stop:

- `pnpm -r build` passes.
- `pnpm cli init` completes when `AETHERNET_WALLET_PASSPHRASE` is set.
- `pnpm cli run --dry` executes successfully after init.
- All local API route families in the Final MVP surface are present (`auth`, `identity`, `x402`, `messages`, `children`, `health`, `metrics`, `alerts`).

Current hard-stop mode:

- Date: 2026-02-18
- Phase: Feature scope frozen. Remaining work is operational hardening only (deployment + docs).

Next actions after hard stop:

- deploy to target environments (Kubernetes or self-hosted) and validate operationally,
- finalize runbook docs for incident response and credentials,
- add environment-specific alert wiring and monitoring.
