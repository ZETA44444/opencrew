#!/bin/bash
# Stores one secret on the server without showing it: it isn't printed, nor left in the shell history.
# Usage:  ~/opencrew/server/poner-clave.sh OC_AI_ANTHROPIC_KEY   (then paste the value and press Enter)
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
name="${1:-}"
case "$name" in
  OC_AI_ANTHROPIC_KEY|OC_AI_GEMINI_KEY|OC_AI_OPENAI_KEY|OC_AI_XAI_KEY|RESEND_API_KEY|PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET|BACKUP_KEY_ID|BACKUP_APP_KEY) file=ai.env ;; # never reaches an engine
  ALERT_URL) file=.env ;;
  *) echo "Nombre no válido. Mira la lista en docs/TAREAS.md"; exit 1 ;;
esac
printf 'Pega el valor de %s y pulsa Enter (no se verá nada al pegar, es normal): ' "$name"
IFS= read -rs value
echo
value="$(printf '%s' "$value" | tr -d '[:space:]')"
[ -n "$value" ] || { echo "No has pegado nada. No se ha cambiado nada."; exit 1; }
# For ntfy it's enough to give the topic name: the rest of the address is added here.
if [ "$name" = ALERT_URL ] && printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{8,64}$'; then value="https://ntfy.sh/$value"; fi
if [ "$name" = ALERT_URL ] && ! printf '%s' "$value" | grep -Eq '^https://[^/]+/.+'; then
  echo "No parece válido. Escribe solo tu nombre de ntfy (mínimo 8 letras o números, sin espacios). No se ha cambiado nada."; exit 1
fi
umask 077
touch "$file"
{ grep -v "^${name}=" "$file" || true; printf '%s=%s\n' "$name" "$value"; } > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"
echo "Guardado (${#value} caracteres)."
if [ "$name" = ALERT_URL ]; then curl -s -o /dev/null --max-time 15 -H "Title: OpenCrew: prueba" -d "✅ Los avisos de tu servidor funcionan." "$value" && echo "Te he enviado un aviso de prueba: míralo en el móvil."; fi
if [ "$file" = ai.env ]; then
  docker compose up -d gateway >/dev/null 2>&1 && echo "Servidor central reiniciado: la clave ya está activa." || echo "No se pudo reiniciar; avísame."
fi
