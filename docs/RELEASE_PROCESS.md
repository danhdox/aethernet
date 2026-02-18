# Release Packaging and Tag Process

## Versioning policy

- Semantic versioning.
- v1.0.0 is first GA with hard break from legacy provider naming.

## Release steps

1. Confirm scope freeze in `docs/RELEASE_V1_SCOPE.md`.
2. Ensure migration note is published (`docs/BREAKING_CHANGE_MIGRATION.md`).
3. Build all packages:
   - `pnpm -r build`
4. Update versions + changelog.
5. Create annotated git tag (`v1.0.0`).
6. Publish release artifacts and release notes.

Helper script:

```bash
scripts/release/prepare-v1.sh v1.0.0
```

## Artifact set

- npm packages in workspace (or internal registry equivalents)
- deployment manifests under `deploy/`
- docs bundle under `docs/`

## Gate checklist

- Build passes.
- Staging soak report attached.
- Canary plan approved.
- Rollback plan validated.
