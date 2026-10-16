# F170 Komite KSO — uji schema `kso`

Implementasi rujukan dari Paket Komite KSO v1.0 (Direktur, 15 Okt 2026), diterjemahkan ke stack WRG-OS.

| Berkas | Isi |
|---|---|
| `infra/postgres/init/224–226` | Skema, fungsi, view — salinan apa adanya dari paket (`001`–`003`) + ambang awal `kso.parameter` |
| `infra/postgres/init/227` | Hak akses versi WRG-OS (pengganti `005_akses_supabase.sql`) |
| `infra/postgres/init/229` | `kso.lengkapi_draft` + pembungkus bot; jumlah & klausul wajib DINYATAKAN sebelum `#KSO kirim`; akun `bot-wa` |
| `infra/postgres/init/228` | `kso.segarkan_referensi()` — isi referensi dari tabel OS + klausul khusus + perbaikan gerbang 3 |
| `004_data_contoh.sql` | Data contoh untuk uji saja — angka FIKTIF, jangan dimuat ke dev/prod |
| `900_uji.sql` | 67 uji alur (dari paket, hanya harga Z3 diganti angka fiktif) |
| `901_uji_akses_wrg.sql` | 22 uji hak akses (terjemahan `901_uji_akses.sql` + 2 uji tanpa-identitas) |
| `902_uji_referensi.sql` | 13 uji pemetaan OS → kso dengan tabel OS tiruan (angka fiktif) |
| `903_uji_lengkapi_draft.sql` | 16 uji melengkapi draft lewat WA sebagai `bot_wa` |

```bash
# Postgres sekali pakai, BUKAN server yang memuat wrg_os_dev/prod
PGHOST=127.0.0.1 PGPORT=5544 PGUSER=postgres bash scripts/qa/kso-komite/jalankan_uji.sh
# → Ringkasan: 118 LULUS, 0 GAGAL (galat SQL apa pun dihitung GAGAL)
```

## Padanan Supabase → WRG-OS

| Paket (Supabase) | WRG-OS |
|---|---|
| `auth.uid()` | `kso.uid_saya()` = GUC transaksi `wrg.kso_user`; API mengisinya dengan `set_config('wrg.kso_user', <JWT sub>, true)` |
| role `authenticated` | `wrg_app` |
| role `anon` | tak ada padanan; `wrg_readonly` / `wrg_demo_app` / PUBLIC tanpa hak |
| `service_role` lolos pagar peran | dihapus — job terjadwal diberi hak eksplisit (Tahap 5) |
| `kso.pengguna.auth_uid uuid` | `kso.pengguna.user_id text` (= `master_user.id`) |

Aplikasi tidak pernah `UPDATE` tabel `kso` langsung: `wrg_app` hanya punya `SELECT` (lewat RLS) dan `EXECUTE` pada pembungkus `kso.app_*`.
