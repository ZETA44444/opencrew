# OpenCrew gateway: accounts and sessions in front of the engines (no privileges, no Docker).
# Built from the repository root: it shares the price lists with the engines (src/core/pricelists.js).
FROM node:22-alpine
RUN apk add --no-cache tini && mkdir -p /data && chown node:node /data
WORKDIR /app/gateway
COPY gateway/index.mjs gateway/ai.mjs ./
COPY src/core/pricelists.js /app/src/core/pricelists.js
VOLUME /data
USER node
EXPOSE 8786
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.mjs"]
