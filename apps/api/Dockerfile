# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @moneybee/api --workspace @moneybee/shared --include-workspace-root=false --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @moneybee/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --workspace @moneybee/api --workspace @moneybee/shared --include-workspace-root=false --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY packages/shared packages/shared
COPY db/migrations db/migrations
COPY policies policies
COPY scripts/webhook-sink.mjs scripts/webhook-sink.mjs
ENV MIGRATIONS_DIR=/app/db/migrations POLICIES_DIR=/app/policies
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
