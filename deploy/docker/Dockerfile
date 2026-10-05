FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app/harness
COPY harness/ ./
RUN npm ci --ignore-scripts && npm run hydrate:model-data && npm run build:offline

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app/harness
COPY --from=build --chown=node:node /app/harness/ ./
RUN mkdir -p /var/lib/klerm /workspaces/project && chown -R node:node /var/lib/klerm /workspaces
ENV HOME=/var/lib/klerm KLERM_SERVER_HOST=0.0.0.0 KLERM_SERVER_PORT=8787 KLERM_WORKSPACE=/workspaces/project KLERM_SERVER_STATE_DIR=/var/lib/klerm/server
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(s=>{if(!s.ready)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/harness/packages/coding-agent/dist/headless-entry.js"]
