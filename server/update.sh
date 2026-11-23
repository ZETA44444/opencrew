#!/bin/sh
# Update the server to the latest version from GitHub. Run on the server: ~/opencrew/server/update.sh
# (Wrapped in { } so the shell reads it all first: git pull may change this very file.)
{
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
cd server
mkdir -p data-puente
# Secret between the main server and the launcher (created once).
grep -q '^OPENCREW_SECRET_KEY=' .env || printf 'OPENCREW_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
grep -q '^LAUNCHER_KEY=' .env || printf 'LAUNCHER_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
# The main server runs as an unprivileged user (uid 1000): it must own its data.
[ -z "$(sudo find data ! -uid 1000 -print -quit)" ] || sudo chown -R 1000:1000 data
[ "$(stat -c %u data-puente)" = 1002 ] || sudo chown -R 1002:1002 data-puente
docker pull node:22-alpine >/dev/null
echo 'Preparando el ordenador de los bots…'
docker build -q -t opencrew-computer computer >/dev/null
docker compose up -d --build
# Caddy keeps the old Caddyfile after git replaces it: restart it so changes apply.
docker compose restart caddy >/dev/null
docker image prune -f >/dev/null
docker compose ps
exit 0
}
