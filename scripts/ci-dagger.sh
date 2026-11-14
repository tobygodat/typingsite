#!/usr/bin/env bash
# Local OSS execution only. This never enables Dagger Cloud or deploys.
set -euo pipefail
cd "$(dirname "$0")/.."
version=1.0.0-beta.27
if ! dagger version | grep -Fq "v${version}"; then
  printf 'Install Dagger %s using the official installer; see docs/CONVENTIONS.md.\n' "$version" >&2
  exit 1
fi
args=(--module stilltype-ci)
case "${1:-all}" in
  all) ;;
  unit) args+=(--check unit-build) ;;
  chromium[1-6]) args+=(--check "$1") ;;
  firefox-compat|webkit-compat) args+=(--check "$1") ;;
  *) echo 'Usage: scripts/ci-dagger.sh [all|unit|chromium1..chromium6|firefox-compat|webkit-compat]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then echo 'Only one selection is accepted.' >&2; exit 2; fi
exec dagger check "${args[@]}" --parallel 2 \
  --engine="image://registry.dagger.io/engine:v${version}" --progress=plain
