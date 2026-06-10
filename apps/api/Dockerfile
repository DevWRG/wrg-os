# syntax=docker/dockerfile:1
# @wrg/api — Hono event ingestion service.
# Build context = monorepo root (lihat docker-compose.yml: `context: .`).
#   docker build -f apps/api/Dockerfile -t wrg-api .

FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

# 1) Manifests dulu → layer cache untuk pnpm install.
#    Semua workspace member harus ada agar --frozen-lockfile cocok.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/web/package.json        apps/web/
COPY apps/api/package.json        apps/api/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json  packages/types/

RUN pnpm install --frozen-lockfile

# 2) Source lengkap + build @wrg/api (tsc → apps/api/dist).
#    node_modules host di-exclude via .dockerignore, jadi tidak menimpa hasil install.
COPY . .
RUN pnpm --filter @wrg/api build

# 3) Runtime. PORT=4000 agar cocok dengan mapping compose (4000:4000)
#    & NEXT_PUBLIC_API_URL. Default lokal non-docker tetap 8092.
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
WORKDIR /repo/apps/api
CMD ["node", "dist/index.js"]

# CATATAN: image ini belum size-optimized — masih membawa devDependencies
# & deps workspace lain (mis. apps/web). Optimasi lanjutan: multi-stage +
# `pnpm --filter @wrg/api deploy --prod` untuk runner yang ramping.
