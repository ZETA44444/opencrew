#!/bin/sh
# Update the server to the latest version from GitHub. Run on the server: ~/opencrew/server/update.sh
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
cd server
docker pull node:22-alpine >/dev/null
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
