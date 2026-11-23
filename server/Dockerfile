# OpenCrew server (engine). Build from the repository root: docker build -f server/Dockerfile .
# The same image runs the owner's engine and one isolated engine per user (created by the launcher).
FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server/index.mjs server/launcher-client.mjs server/extension-link.mjs ./server/
ENV NODE_ENV=production OPENCREW_DATA=/data/ PORT=8787
# /data belongs to the unprivileged user, so new per-user volumes start writable.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
# Runs without privileges and without Docker: bot computers are requested to the launcher.
USER node
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.mjs"]
