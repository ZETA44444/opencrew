#!/bin/bash
# OpenCrew server health, every 5 minutes (systemd timer installed by update.sh). Writes a summary the
# administrator sees in the app (Ajustes → Cuenta) and, if ALERT_URL is set in .env, sends an alert
# (a plain-text POST: works with ntfy.sh topics, and with most «webhook» notification services).
set -u
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SERVER="${OPENCREW_SERVER_DIR:-/home/opencrew/opencrew/server}"
cd "$SERVER" || exit 0
HOST=$(grep '^OPENCREW_HOST=' .env | cut -d= -f2)
ALERT_URL=$(grep '^ALERT_URL=' .env | cut -d= -f2- || true)
problems=()
disk=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
mem=$(free -m | awk '/^Mem:/ {print $7}')
[ "$disk" -ge 85 ] && problems+=("disco al ${disk} %")
[ "$mem" -lt 400 ] && problems+=("solo quedan ${mem} MB de memoria")
for s in caddy gateway opencrew launcher; do
  st=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$s" '$1==s {print $2}')
  [ "$st" = "running" ] || problems+=("el servicio ${s} no está en marcha (${st:-parado})")
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${HOST}/api/health" || echo 000)
[ "$code" = "200" ] || problems+=("la web no responde (código ${code})")
engines=$(docker ps --filter label=opencrew=engine -q | wc -l)
pcs=$(docker ps --filter label=opencrew=computer -q | wc -l)
ok=true; [ ${#problems[@]} -gt 0 ] && ok=false
msg=$(printf '%s; ' "${problems[@]:-}" | sed 's/; $//')
printf '{"at":%s000,"ok":%s,"disk":%s,"memFreeMb":%s,"engines":%s,"computers":%s,"problems":"%s"}\n' \
  "$(date +%s)" "$ok" "$disk" "$mem" "$engines" "$pcs" "$msg" > data-gateway/health.json.tmp
chown 1000:1000 data-gateway/health.json.tmp && mv data-gateway/health.json.tmp data-gateway/health.json
# Alert once per problem (again after 6 hours if it goes on), and when it's fixed.
state=/var/tmp/opencrew-alert
if [ -n "${ALERT_URL}" ]; then
  last=$(cat "$state" 2>/dev/null || echo "")
  now=$(date +%s)
  if [ "$ok" = false ]; then
    lastmsg=${last#* }; lastat=${last%% *}
    if [ "$lastmsg" != "$msg" ] || [ $((now - ${lastat:-0})) -gt 21600 ]; then
      curl -s --max-time 15 -H 'Title: OpenCrew: algo falla' -d "⚠️ ${msg}" "$ALERT_URL" >/dev/null && echo "$now $msg" > "$state"
    fi
  elif [ -n "$last" ]; then
    curl -s --max-time 15 -H 'Title: OpenCrew' -d "✅ Todo vuelve a funcionar" "$ALERT_URL" >/dev/null && rm -f "$state"
  fi
fi
