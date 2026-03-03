#!/bin/sh
# Start API server + dashboard dev server together.
# Usage: ./dev.sh
trap 'kill 0' EXIT
cargo run -p veha-api &
(cd veha-dashboard && bun run dev) &
wait
