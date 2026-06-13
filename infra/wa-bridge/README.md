# WA bridge (host)

Jembatan antara wrg-os (container) dan **openclaw** (CLI + capture) yang hidup di
HOST. Wajib jalan di mesin yang sama dengan openclaw (Mac), bukan di dalam compose.

```
wrg-os api (container) --WA_SEND_URL--> bridge /send --> openclaw message send
openclaw capture jsonl --tail--> bridge --> wrg-os /webhooks/wa
```

## Jalankan (host)

```bash
# kirim (dari container ke host): wrg-os WA_SEND_URL=http://host.docker.internal:18080/send
WA_BRIDGE_PORT=18080 \
WA_BRIDGE_SECRET="$WA_SEND_SECRET" \        # = WA_SEND_SECRET di wrg-os
WA_BRIDGE_SEND_LIVE=false \                  # 'true' utk kirim ASLI (langkah go-live terakhir)
WRG_WEBHOOK_URL=http://localhost:4000/webhooks/wa \
WRG_WEBHOOK_SECRET="$WA_WEBHOOK_SECRET" \    # = WA_WEBHOOK_SECRET di wrg-os
node infra/wa-bridge/bridge.mjs
```

Daemonize (pilih salah satu): `launchd` plist, `pm2 start bridge.mjs`, atau
`nohup ... &`. Tanpa dependency npm (Node ≥ 18 untuk `fetch`).

## ENV

| Var | Default | Fungsi |
|---|---|---|
| `WA_BRIDGE_PORT` | 18080 | port server `/send` |
| `WA_BRIDGE_SECRET` | '' | header `x-wa-secret` wajib bila di-set (= `WA_SEND_SECRET`) |
| `WA_BRIDGE_SEND_LIVE` | false | **false = log saja** (dry host); true = `openclaw message send` asli |
| `WA_CHANNEL` | whatsapp | channel openclaw |
| `OPENCLAW_BIN` | openclaw | path biner |
| `WRG_WEBHOOK_URL` | '' | inbound OFF bila kosong; mis. `http://localhost:4000/webhooks/wa` |
| `WRG_WEBHOOK_SECRET` | '' | header `x-wa-secret` ke webhook (= `WA_WEBHOOK_SECRET`) |
| `CAPTURE_DIR` | `~/.openclaw/tmp/wrg-monitor/messages` | sumber capture inbound |
| `POLL_MS` | 4000 | interval tail |
| `OFFSET_FILE` | `~/.wrg-wa-bridge-offsets.json` | posisi baca per-file (restart-safe) |

## Catatan

- **Dua lapis dry-run**: wrg-os `WA_DRY_RUN` (tak panggil bridge sama sekali) +
  bridge `WA_BRIDGE_SEND_LIVE` (tak panggil openclaw). Go-live = matikan keduanya.
- Inbound: scan pertama **tidak replay** histori (offset = EOF); hanya append baru
  diteruskan. Format capture = `OpenclawRecord` → wrg-os idempoten (input_hash),
  aman bila terkirim ganda.
- Pesan `fromMe` di-skip (tak ikut diproses).
