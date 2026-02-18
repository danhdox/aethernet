#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v1.0.0}"

pnpm -r build

echo ""
echo "Release preparation complete."
echo "Next commands:"
echo "  git add -A"
echo "  git commit -m \"release: ${VERSION}\""
echo "  git tag -a ${VERSION} -m \"Aethernet ${VERSION}\""
echo "  git push origin HEAD --tags"
