# The «computer» each bot can use on your server: a terminal and a real (headless) Chromium.
# Built by server/update.sh as image «opencrew-computer». One container per bot, created on demand.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_BROWSERS_PATH=/opt/browsers NODE_PATH=/usr/local/lib/node_modules
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl wget git jq unzip zip python3 python3-pip python3-venv less nano procps fonts-noto-color-emoji \
 && npm install -g playwright \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm
RUN useradd -m -u 1001 bot && mkdir -p /work && chown bot:bot /work
COPY browse.mjs /opt/oc/browse.mjs
USER bot
WORKDIR /work
CMD ["sleep", "infinity"]
