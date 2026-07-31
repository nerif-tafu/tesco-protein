#!/bin/sh
set -eu

export DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

cmd="${1:-serve}"

case "$cmd" in
  serve|web|"")
    exec node /app/server.mjs
    ;;
  scrape)
    shift
    node /app/scrape.mjs "$@"
    node /app/scripts/export-web-data.mjs
    ;;
  export-web)
    shift
    exec node /app/scripts/export-web-data.mjs "$@"
    ;;
  rank)
    shift
    exec node /app/rank.mjs "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
