#!/usr/bin/env bash
# Build what's committed on main and (re)start the live app from this folder.
#   deploy/deploy.sh
# The live app runs from this same repo, so it only deploys a clean main: unfinished work
# belongs on a branch, and the folder should be back on main before a tournament.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd -P)"
export PATH="$HOME/.local/bin:$PATH" # uv

if [ "$(git branch --show-current)" != "main" ] || [ -n "$(git status --porcelain)" ]; then
  echo "deploy.sh only deploys a clean main. Commit or stash your changes, then: git switch main" >&2
  exit 1
fi

echo "→ Installing backend packages"
(cd backend && uv sync --frozen)

echo "→ Building the frontend"
(cd frontend && npm ci --no-audit --no-fund --loglevel=error && npm run build)

echo "→ Installing the systemd units"
mkdir -p ~/.config/systemd/user ~/apps/wsf-data
for unit in wsf-tournament.service wsf-backup.service wsf-backup.timer; do
  sed "s|@REPO@|$REPO|g" "deploy/systemd/$unit" > ~/.config/systemd/user/"$unit"
done
systemctl --user daemon-reload

if systemctl --user is-enabled --quiet wsf-tournament 2>/dev/null; then
  echo "→ Restarting the app"
  systemctl --user restart wsf-tournament
  for _ in $(seq 20); do
    if curl -fsS http://127.0.0.1:8420/api/health >/dev/null 2>&1; then
      echo "✓ Live at http://127.0.0.1:8420 ($(git log -1 --format='%h %s'))"
      exit 0
    fi
    sleep 0.5
  done
  echo "✗ The app didn't come back. Check: journalctl --user -u wsf-tournament -n 50" >&2
  exit 1
else
  echo "✓ Built. First time? Enable the service: systemctl --user enable --now wsf-tournament wsf-backup.timer"
fi
