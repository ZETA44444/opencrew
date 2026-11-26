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
if [ "$name" = ALERT_URL ] && ! printf '%s' "$value" | grep -Eq '^https://[^/]+/.+'; then
  echo "Falta la dirección completa. Tiene que ser https://ntfy.sh/ seguido de tu nombre, todo junto. No se ha cambiado nada."; exit 1
fi
umask 077
touch "$file"
{ grep -v "^${name}=" "$file" || true; printf '%s=%s\n' "$name" "$value"; } > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"
echo "Guardado (${#value} caracteres)."
if [ "$file" = ai.env ]; then
  docker compose up -d gateway >/dev/null 2>&1 && echo "Servidor central reiniciado: la clave ya está activa." || echo "No se pudo reiniciar; avísame."
fi
