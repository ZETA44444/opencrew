# OpenCrew gateway: accounts and sessions in front of the engines (no privileges, no Docker).
FROM node:22-alpine
RUN apk add --no-cache tini && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY index.mjs ./
VOLUME /data
USER node
EXPOSE 8786
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.mjs"]
