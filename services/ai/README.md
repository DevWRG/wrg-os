# services/ai — WRG AI & Data Microservice

Tier AI & data (Python **FastAPI**) untuk WRG-OS. Tempat logika yang lebih cocok
di Python: ringkasan LLM (daily-summary/rekap), embeddings/pgvector, pemrosesan
dokumen/geotag. Dipanggil oleh backend domain (`apps/api`) / gateway (`apps/web`).

> **Status:** scaffold (Fase 3). `/summarize` masih stub deterministik —
> integrasi OpenRouter & port logika dari `legacy/crm`, `legacy/monitor`
> menyusul (Fase 4+).

## Menjalankan (lokal)

```bash
cd services/ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Port **8000** (3000=web, 4000=api, 8090–8092 dipakai dashboard Python WRG live).

## Endpoints

| Method | Path | Keterangan |
|---|---|---|
| `GET`  | `/health` | `{ status, service }` |
| `POST` | `/summarize` | Ringkas aktivitas grup → digest (mirror `DigestRekap` di `@wrg/types`) |

```bash
curl -X POST localhost:8000/summarize -H 'content-type: application/json' -d '{
  "group_jid":"120...@g.us","period_start":"2026-06-09","period_end":"2026-06-10",
  "items":["RS A - SJ selesai","PO 2253 estimasi kirim 16 Mei"]
}'
```
