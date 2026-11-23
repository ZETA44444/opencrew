#!/bin/bash
# Instala OpenCrew Escritorio en este Mac: se abre solo al encender y crea «OpenCrew Escritorio»
# en tu carpeta Aplicaciones para abrir sus ajustes. Para quitarlo: desinstalar.command
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/OpenCrew Escritorio"
PLIST="$HOME/Library/LaunchAgents/com.opencrew.escritorio.plist"
APP="$HOME/Applications/OpenCrew Escritorio.app"
NODE="$(command -v node || true)"
for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -z "$NODE" ] && [ -x "$c" ] && NODE="$c"; done
if [ -z "$NODE" ]; then echo "Necesitas Node.js 22 o superior: https://nodejs.org (descarga la versión LTS) y vuelve a abrir este instalador."; read -r -p "Pulsa Enter para cerrar"; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then echo "Tu Node.js es la versión $MAJOR y hace falta la 22 o superior: https://nodejs.org"; read -r -p "Pulsa Enter para cerrar"; exit 1; fi
echo "Instalando OpenCrew Escritorio…"
mkdir -p "$DEST" "$HOME/Library/LaunchAgents" "$HOME/Applications"
cp "$SRC/app.mjs" "$SRC/page.mjs" "$DEST/"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.opencrew.escritorio</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DEST/app.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/app.log</string>
  <key>StandardErrorPath</key><string>$DEST/app.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for i in $(seq 1 20); do [ -f "$DEST/ajustes.url" ] && break; sleep 0.5; done
# A small app that opens the settings page (with its private link).
rm -rf "$APP"
osacompile -o "$APP" -e "do shell script \"open \\\"\$(cat \\\"$DEST/ajustes.url\\\")\\\"\"" >/dev/null
echo "✓ Instalado. Se abre solo cada vez que enciendes el Mac."
echo "  Ajustes: abre «OpenCrew Escritorio» en tu carpeta Aplicaciones (de tu usuario)."
open "$(cat "$DEST/ajustes.url")"
