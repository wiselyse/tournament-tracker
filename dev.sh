#!/usr/bin/env bash
# Start the backend (FastAPI, :8421) and the frontend dev server (Vite, :5173) together.
# (8420 is the live app's port, so dev can run next to it.)
# Ctrl+C stops both. Open http://127.0.0.1:5173, or from another device through `tailscale serve`.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH" # where the uv installer puts uv

# First run: install frontend packages (uv installs Python packages on its own).
[ -d frontend/node_modules ] || (cd frontend && npm ci)

# On Ctrl+C, or if either server dies, stop everything this script started.
trap 'trap - INT TERM EXIT; kill 0 2>/dev/null' INT TERM EXIT

(cd backend && uv run uvicorn wsf_tournament.app:app --reload --host 127.0.0.1 --port 8421) &
(cd frontend && npm run dev) &

wait -n # returns as soon as either server exits
