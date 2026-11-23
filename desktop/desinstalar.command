#!/bin/bash
# Quita OpenCrew Escritorio de este Mac (tus carpetas y archivos no se tocan).
PLIST="$HOME/Library/LaunchAgents/com.opencrew.escritorio.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$HOME/Library/Application Support/OpenCrew Escritorio" "$HOME/Applications/OpenCrew Escritorio.app"
echo "✓ OpenCrew Escritorio se ha desinstalado."
read -r -p "Pulsa Enter para cerrar"
