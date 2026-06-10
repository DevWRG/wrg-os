# WRG Monorepo

Monorepo platform operasional **Wahana Lifeline / PT Wahana Rizky Gumilang (WRG)** — distribusi alat kesehatan B2B. Dikelola dengan [Turborepo](https://turbo.build) + [pnpm workspaces](https://pnpm.io/workspaces).

## Arsitektur target (3-tier)

```
apps/
  web/        Next.js — FRONTEND + API GATEWAY (BFF)
  api/        Node/Hono — BACKEND domain API (TS; event ingestion ADR-024)
services/
  ai/         Python FastAPI — microservice AI & DATA  (🚧 menyusul, Fase 3)
packages/
  config/     @wrg/config — shared tsconfig / eslint / tailwind
  types/      @wrg/types — tipe domain bersama (Blueprint v2.3)
  ui/         🚧 kosong
legacy/
  crm/        WRG CRM Python+shell — sistem PROD (referensi, dipensiunkan bertahap)
  monitor/    WRG Monitor Python+shell — referensi prod
infra/        docker (compose), nginx, postgres
```

Alur: **web (gateway)** → **api (domain, Hono)** → **services/ai (FastAPI, AI/data)**.

> **Status (Fase 1 — restruktur):** `apps/web` = frontend Next.js (eks `apps/os`,
> masih mock data). `apps/api` = backend Hono (event ingestion). `legacy/crm` &
> `legacy/monitor` = kode Python prod yang masih jalan, dipindah ke `legacy/`
> sebagai referensi; logikanya dimigrasikan bertahap ke `api` (domain) &
> `services/ai` (AI/data) di fase berikutnya. `services/ai` belum dibuat.

## Prasyarat

- Node.js ≥ 20 (dev memakai v25)
- pnpm (`npm install -g pnpm`)

## Perintah

```bash
pnpm install            # install semua workspace
pnpm dev                # turbo run dev
pnpm build              # turbo run build
pnpm lint               # turbo run lint
pnpm typecheck          # turbo run typecheck

# Per-app:
pnpm --filter @wrg/web dev      # frontend Next.js (port 3000)
pnpm --filter @wrg/api dev      # backend Hono (port 4000)
```
