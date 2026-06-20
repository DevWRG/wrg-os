# Runbook — openclaw WhatsApp Gateway: Watchdog & Recovery

Konteks: pada 2026-06-19 gateway openclaw mati diam-diam ~17:00–19:59 WIB.
Selama jendela itu **0 pesan ter-capture** → 28 `#Report` sales hilang tanpa
jejak (tidak masuk `wa_message`, tidak dibalas). Dokumen ini mencatat (1)
watchdog pencegahan, dan (2) prosedur pemulihan dari export chat WhatsApp.

---

## 1. Watchdog gateway

Skrip: `scripts/ops/gateway-watchdog.sh` (dijalankan cron tiap 2 menit).
State & log ditulis ke `~/DevWRG/ops/` (di luar repo): `gateway-watchdog.log`,
`gateway-watchdog.cron.log`, `.gateway-watchdog-state.json`.

Cron:
```
*/2 * * * * cd /Users/development/DevWRG/wrg-os && bash scripts/ops/gateway-watchdog.sh >> /Users/development/DevWRG/ops/gateway-watchdog.cron.log 2>&1 # OPENCLAW-WATCHDOG
```

Mode: **auto-restart + alert**.

Deteksi "tidak sehat" (salah satu):
- `openclaw channels status --json` timeout/gagal → gateway wedged
- `channels.whatsapp.connected|running|linked == false`
- (jam aktif 07–22 WIB) `lastInboundAt` > 75 menit → connected tapi diam

Aksi (debounce 2× cek ≈ 4 menit):
- restart: `launchctl kickstart -k gui/<uid>/ai.openclaw.gateway` (cooldown 10 mnt)
- alert WA ke owner via bridge `/send` (cooldown 30 mnt)

Catatan teknis:
- macOS tidak punya `timeout`/`gtimeout` → skrip pakai `perl -e 'alarm shift; exec @ARGV'`.
- Belum 100% terbukti `launchctl kickstart` jalan dari konteks cron (jalur no-op
  sudah terverifikasi). Cek `gateway-watchdog.log` saat ada event restart nyata.

Manual cek:
```bash
openclaw channels status --channel whatsapp --json | python3 -m json.tool | grep -E 'connected|running|linked|lastInboundAt'
launchctl print "gui/$(id -u)/ai.openclaw.gateway" | grep -E 'state|pid'
```

---

## 2. Pemulihan report yang hilang saat capture-gap

Saat gateway gap, pesan TIDAK ter-capture. `openclaw message read` **tidak
didukung untuk WhatsApp**, jadi satu-satunya sumber = **export chat WhatsApp**
(user ekspor manual per grup: Settings → Export chat; hasil `.zip` berisi
`_chat.txt`, format `DD/MM/YY HH.MM - Sender: body`, body multi-line).

Langkah:
1. Unzip; parse `_chat.txt` (timestamp WIB; body multi-line s/d baris timestamp berikut).
2. Filter tanggal + jendela jam gap; ambil baris yang cocok `^#\s*(report|plan)`.
3. Cross-check ke DB: resolve nama → `am_id` (via `panggilan`/`nama`); cek apakah
   sudah ada di `activity_log` / `sales_todo.reported`. Ambil yang BELUM.
4. Map export-group → `group_jid` via subject di
   `~/.openclaw/agents/main/sessions/sessions.json` (cari `"subject":"<nama>"`
   + jid `@g.us` terdekat). JID kunci:
   - The ALLIANCE = `120363405485256544@g.us`
   - GROUP TRAINING KRM-TAGIH = `6281335118687-1517798430@g.us`
   - FINANCE & TAX WRG = `6282232418991-1555990746@g.us`
   - Accounting & Purchasing WRG = `120363215877961952@g.us`
   - GA WRG = `120363403842555552@g.us`
5. **PAKSA TANGGAL.** `apps/api/src/repo/inbound.ts` (≈baris 409):
   `tanggal = parsed.tanggal ?? wibDate()` → body tanpa tanggal akan tercatat
   HARI INI. Sisipkan `19/06/2026` (tanggal asli) ke baris header report yang
   tidak memuat tanggal SEBELUM di-feed.
6. Feed tiap record ke `POST /webhooks/wa` (header `x-wa-secret` = `WA_WEBHOOK_SECRET`):
   ```json
   {"messages":[{"group_jid":"<jid>","sender":"<jid>","sender_name":"<nama tampilan>",
     "body":"<isi report>","ts":"2026-06-19T..Z","message_id":"<unik>"}]}
   ```
   Kirim satu-satu + jeda ~2 dtk (anti gateway-flood). Dengan `WA_DRY_RUN=false`,
   balasan `✅ Report tercatat` benar-benar terkirim ke grup.

Sifat aman:
- Idempoten by `input_hash`; `sales_todo` `ON CONFLICT (am_id, tanggal)`.
- Resolver memakai body-name (nama setelah `#report`) sebagai primer, pushname
  sebagai fallback. Pada 2026-06-20, 29/29 record ter-resolve untuk 19 Jun
  (termasuk nama tak persis: "joni" → Agus, "Prayugo" → Yugo via pushname).

Verifikasi akhir:
```sql
SELECT count(*) FROM sales_todo WHERE tanggal='2026-06-19' AND reported;     -- naik
SELECT count(*) FROM sales_todo WHERE tanggal='<HARI_INI>' AND reported;     -- harus 0 dari recovery
```
