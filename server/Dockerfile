# OpenCrew server. Build from the repository root: docker build -f server/Dockerfile .
FROM node:22-alpine
RUN apk add --no-cache docker-cli tini
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY server/index.mjs server/sandbox.mjs ./server/
ENV NODE_ENV=production OPENCREW_DATA=/data/ PORT=8787
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.mjs"]
