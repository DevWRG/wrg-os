# @wrg/api

API layer bersama untuk WRG-OS — event ingestion (ADR-024) di atas [Hono](https://hono.dev).

## Menjalankan

```bash
pnpm --filter @wrg/api dev      # tsx watch (hot reload)
pnpm --filter @wrg/api build    # tsc → dist/
pnpm --filter @wrg/api start    # node dist/index.js
```

Default port **4000** (override via `PORT`). Port Python WRG yang LIVE di mesin: 8090 (monitor), 8091 (crm-prod), 8092 (crm-dev) — JANGAN dipakai. 3000 = apps/web.

## Endpoints

| Method | Path | Keterangan |
|---|---|---|
| `GET`  | `/health` | Health check → `{ status, service }` |
| `POST` | `/events` | Ingest `EventEnvelope`. `202` jika valid, `400` JSON rusak, `422` bukan envelope valid |

Tipe `EventEnvelope` berasal dari [`@wrg/types`](../../packages/types) (compile-time, di-erase saat runtime). Validasi runtime via `isEventEnvelope()` di `src/envelope.ts`.

### Contoh

```bash
curl -X POST localhost:4000/events -H 'content-type: application/json' -d '{
  "event_id":"01J...","correlation_id":"sess-1","causation_id":"01J...",
  "type":"accurate.invoice.owing.v1","source":"accurate-sync","occurred_at":"2026-06-10T10:00:00Z",
  "use_case_id":"D2","r_tier":"R2","schema_version":"1","payload":{},"input_hash":"sha256:..."
}'
```
