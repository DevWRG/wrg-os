# syntax=docker/dockerfile:1
# @wrg/web — Next.js dashboard + BFF gateway.
# Build context = monorepo root (docker-compose: `context: .`).
#   docker build -f apps/web/Dockerfile -t wrg-web .

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /repo

# 1) Manifests dulu → layer cache untuk pnpm install (semua workspace member).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/web/package.json        apps/web/
COPY apps/api/package.json        apps/api/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json  packages/types/

RUN pnpm install --frozen-lockfile

# 2) Source lengkap + build @wrg/web (next build → apps/web/.next).
COPY . .
RUN pnpm --filter @wrg/web build

# 3) Runtime: next start di PORT 3000 (cocok dengan mapping compose).
#    API_URL & AUTH_ENABLED dibaca runtime (bukan NEXT_PUBLIC_*), jadi tidak
#    perlu di-bake saat build.
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
WORKDIR /repo/apps/web
CMD ["pnpm", "start"]

# CATATAN: belum size-optimized (membawa devDeps + workspace lain). Optimasi
# lanjutan: next `output: "standalone"` + multi-stage runner ramping.
