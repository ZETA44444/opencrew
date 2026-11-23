# The «computer» each bot can use on your server: a small Linux desktop (virtual screen) with a real
# Chromium you can watch and take over, plus a terminal. Built by server/update.sh as «opencrew-computer».
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_BROWSERS_PATH=/opt/browsers LANG=es_ES.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl wget git jq unzip zip python3 python3-pip python3-venv less nano procps \
      xvfb x11vnc xdotool fluxbox xterm socat fonts-dejavu fonts-noto-color-emoji locales \
 && sed -i 's/# es_ES.UTF-8/es_ES.UTF-8/' /etc/locale.gen && locale-gen \
 && npm install -g playwright \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm
RUN useradd -m -u 1001 bot && mkdir -p /work && chown bot:bot /work
COPY browse.mjs start.sh /opt/oc/
RUN chmod +x /opt/oc/start.sh
USER bot
WORKDIR /work
ENV DISPLAY=:99
CMD ["/opt/oc/start.sh"]
