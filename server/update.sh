#!/bin/sh
# Update the server to the latest version from GitHub. Run on the server: ~/opencrew/server/update.sh
# (Wrapped in { } so the shell reads it all first: git pull may change this very file.)
{
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
cd server
mkdir -p data-gateway
[ "$(stat -c %u data-gateway)" = 1000 ] || sudo chown -R 1000:1000 data-gateway
# One-time code to create the administrator account in the app (read it with: grep GATEWAY_SETUP_CODE .env).
grep -q '^GATEWAY_SETUP_CODE=' .env || printf 'GATEWAY_SETUP_CODE=%s\n' "$(openssl rand -hex 8)" >> .env
# Secret between the main server and the launcher (created once).
grep -q '^OPENCREW_SECRET_KEY=' .env || printf 'OPENCREW_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
grep -q '^LAUNCHER_KEY=' .env || printf 'LAUNCHER_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
# The main server runs as an unprivileged user (uid 1000): it must own its data.
[ -z "$(sudo find data ! -uid 1000 -print -quit)" ] || sudo chown -R 1000:1000 data
# The built app, published on the gh-pages branch, also served from this server.
git -C .. fetch -q origin gh-pages
rm -rf web.new && mkdir web.new && git -C .. archive origin/gh-pages | tar -x -C web.new
rm -rf web && mv web.new web
docker pull node:22-alpine >/dev/null
echo 'Preparando el ordenador de los bots…'
docker build -q -t opencrew-computer computer >/dev/null
# Firewall for the bots' computers, applied now and at every boot (after Docker).
if [ ! -f /etc/systemd/system/opencrew-firewall.service ] || ! cmp -s "$PWD/firewall.sh" /usr/local/sbin/opencrew-firewall.sh; then
  sudo install -m 755 "$PWD/firewall.sh" /usr/local/sbin/opencrew-firewall.sh
  printf '[Unit]\nDescription=OpenCrew: firewall for bot computers\nAfter=docker.service\nRequires=docker.service\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/opencrew-firewall.sh\nRemainAfterExit=yes\n\n[Install]\nWantedBy=multi-user.target\n' | sudo tee /etc/systemd/system/opencrew-firewall.service >/dev/null
  sudo systemctl daemon-reload && sudo systemctl enable opencrew-firewall.service >/dev/null 2>&1
fi
sudo /usr/local/sbin/opencrew-firewall.sh >/dev/null
docker compose up -d --build --remove-orphans
# Caddy keeps the old Caddyfile after git replaces it: restart it so changes apply.
docker compose restart caddy >/dev/null
docker image prune -f >/dev/null
docker compose ps
exit 0
}
