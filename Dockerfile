# syntax=docker/dockerfile:1.7
# Imagem única do Finah: app (Next standalone), worker, migrate e seed.
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 .
# (cada arquitetura compila no seu próprio estágio, sem binários nativos copiados entre plataformas)

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat && corepack enable
WORKDIR /app

# ── dependências (cache enquanto o lockfile não muda) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ── build: Next standalone + dist/{worker,migrate,seed}.mjs ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── runtime ──
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Sao_Paulo
RUN apk add --no-cache tzdata \
 && addgroup -S -g 1001 finah \
 && adduser -S -u 1001 -G finah finah
WORKDIR /app

COPY --from=build --chown=finah:finah /app/.next/standalone ./
COPY --from=build --chown=finah:finah /app/.next/static ./.next/static
COPY --from=build --chown=finah:finah /app/public ./public
COPY --from=build --chown=finah:finah /app/dist ./dist
COPY --from=build --chown=finah:finah /app/drizzle ./drizzle

USER finah
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

# app (padrão) | worker: node dist/worker.mjs | migrate: node dist/migrate.mjs | seed: node dist/seed.mjs
CMD ["node", "server.js"]
