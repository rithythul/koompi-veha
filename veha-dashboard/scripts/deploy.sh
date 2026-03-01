#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$(dirname "$SCRIPT_DIR")"
STATIC_DIR="$DASHBOARD_DIR/../veha-api/static"

echo "Building dashboard..."
cd "$DASHBOARD_DIR"
bun run build

echo "Deploying to veha-api/static/..."
rm -rf "$STATIC_DIR"/*
cp -r "$DASHBOARD_DIR/dist/"* "$STATIC_DIR/"

echo "Done. Dashboard deployed to $STATIC_DIR"
