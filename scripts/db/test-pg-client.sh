#!/usr/bin/env bash
set -euo pipefail
: "${DRILL_CONTAINER:?Run via test-recovery.sh}"
exec docker exec -i -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGOPTIONS \
  -e PGCLIENTENCODING -e PGCONNECT_TIMEOUT "$DRILL_CONTAINER" "${0##*/}" "$@"
