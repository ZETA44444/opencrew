#!/bin/sh
# Update the server to the latest version from GitHub. Run on the server: ~/opencrew/server/update.sh
# (Wrapped in { } so the shell reads it all first: git pull may change this very file.)
{
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
cd server
docker pull node:22-alpine >/dev/null
echo 'Preparando el ordenador de los bots…'
docker build -q -t opencrew-computer computer >/dev/null
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
exit 0
}
