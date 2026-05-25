#!/bin/sh
set -e

# Dispatch to the right binary based on process selection. Accepts
# either:
#   - First arg ($1)         — used by Fly.io's [processes] config,
#                              which passes the value as CMD args
#                              while ENTRYPOINT stays as this script.
#   - PROCESS_NAME env var   — used by Docker Compose and direct
#                              `docker run` invocations.
# Arg wins if both are set. Defaults to "http" if neither is set.
PROC="${1:-${PROCESS_NAME:-http}}"

case "$PROC" in
    http)
        exec /app/api/bin/api
        ;;
    worker)
        exec /app/worker/bin/worker
        ;;
    *)
        echo "Unknown process '$PROC' (expected 'http' or 'worker')" >&2
        exit 1
        ;;
esac
