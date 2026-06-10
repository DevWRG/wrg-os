# WRG Monorepo

Monorepo untuk platform operasional **Wahana Lifeline / PT Wahana Rizky Gumilang (WRG)** — distribusi alat kesehatan B2B. Dikelola dengan [Turborepo](https://turbo.build) + [pnpm workspaces](https://pnpm.io/workspaces).

## Struktur

```
.
├── apps/
│   ├── os/          # WRG OS — operations dashboard (Next.js 16 / React 19 / TS) — LIVE
│   ├── crm/         # WRG CRM (Python + shell, PostgreSQL) — 🚧 scaffold kosong
│   ├── monitor/     # WRG Monitor (Python + shell) — 🚧 scaffold kosong
│   └── api/         # API layer bersama — 🚧 scaffold kosong
├── packages/
│   ├── ui/          # Komponen UI bersama (shadcn/Base UI) — 🚧 kosong
│   ├── config/      # Config bersama (eslint, tsconfig, tailwind) — 🚧 kosong
│   └── types/       # Tipe TypeScript bersama — 🚧 kosong
├── infra/
│   ├── docker/      # Dockerfile / compose
│   ├── nginx/       # Reverse proxy config
│   └── postgres/    # Init scripts / migrasi
└── .github/workflows/  # CI
```

> **Status (2026-06-10):** baru `apps/os` yang berisi (port dari single-repo
> `wrg-os`). `apps/crm`, `apps/monitor`, `apps/api`, dan seluruh `packages/*`
> masih scaffold kosong — integrasi menyusul. CRM & Monitor saat ini berbasis
> Python + shell di repo terpisah (`DevWRG/wrg-crm`, `DevWRG/wrg-monitor`);
> strategi memasukkannya (copy / submodule / subtree) belum diputuskan.

## Prasyarat

- Node.js ≥ 20 (dev memakai v25)
- pnpm (`npm install -g pnpm`)

## Perintah

```bash
pnpm install            # install semua workspace
pnpm dev                # turbo run dev (semua app yang punya script dev)
pnpm build              # turbo run build
pnpm lint               # turbo run lint
pnpm typecheck          # turbo run typecheck

# Per-app:
pnpm --filter wrg-os dev
```
