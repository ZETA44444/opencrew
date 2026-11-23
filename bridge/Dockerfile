# OpenCrew Puente: the official ChatGPT (Codex) and Claude (Claude Code) CLIs, signed in with your
# own subscriptions, behind a small OpenAI-compatible API that only your OpenCrew server can use.
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git bsdutils procps \
 && npm install -g @openai/codex @anthropic-ai/claude-code \
 && rm -rf /var/lib/apt/lists/* /root/.npm
RUN useradd -m -u 1002 puente && mkdir -p /data && chown puente:puente /data
WORKDIR /app
COPY index.mjs cli.mjs page.mjs ./
USER puente
ENV BRIDGE_DATA=/data PORT=8790
EXPOSE 8790
CMD ["node", "index.mjs"]
