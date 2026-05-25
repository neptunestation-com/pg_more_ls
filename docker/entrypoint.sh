#!/bin/sh
set -e

case "${PROCESS_NAME:-http}" in
    http)
        exec /app/api/bin/api
        ;;
    worker)
        exec /app/worker/bin/worker
        ;;
    *)
        echo "Unknown PROCESS_NAME='$PROCESS_NAME' (expected 'http' or 'worker')" >&2
        exit 1
        ;;
esac
