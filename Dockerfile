# One service: the Grok connector (MCP + REST) also serves the built web app.

FROM oven/bun:1 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
# Baked into the Vite build. All optional: service URLs default to the live JackTrade APIs (src/lib/backend.js),
# the connector defaults to this same origin, and an empty Reown id falls back to the browser-wallet list.
ARG VITE_REOWN_PROJECT_ID=""
ARG VITE_EXPLORER_URL=""
ARG VITE_CONNECTOR_URL=""
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID \
    VITE_EXPLORER_URL=$VITE_EXPLORER_URL \
    VITE_CONNECTOR_URL=$VITE_CONNECTOR_URL
RUN bun run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/connector
COPY connector/package.json connector/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY connector/src ./src
COPY --from=web /app/web/dist /app/web/dist
ENV WEB_DIST=/app/web/dist \
    DB_PATH=/data/connector.db
EXPOSE 8787
CMD ["node", "src/server.ts"]
