#!/bin/bash
# Virtual screen + window manager + VNC (only inside the container) + a Chromium that both the
# bot (through its debugging port) and you (through the screen) use. Everything restarts if it dies.
export DISPLAY=:99
mkdir -p /work/.browser-profile ~/.fluxbox
echo 'session.screen0.toolbar.visible: true' > ~/.fluxbox/init
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
fluxbox >/dev/null 2>&1 &
( while true; do x11vnc -display :99 -forever -shared -nopw -localhost -rfbport 5900 -quiet -noxdamage >/dev/null 2>&1; sleep 1; done ) &
CHROME=$(ls -d /opt/browsers/chromium-*/chrome-linux*/chrome | head -1)
while true; do
  rm -f /work/.browser-profile/Singleton*
  "$CHROME" --no-sandbox --test-type --disable-infobars --disable-dev-shm-usage --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
    --user-data-dir=/work/.browser-profile --no-first-run --no-default-browser-check --disable-features=Translate --disable-blink-features=AutomationControlled \
    --lang=es-ES --window-position=0,0 --window-size=1280,780 --start-maximized about:blank >/dev/null 2>&1
  sleep 2
done
