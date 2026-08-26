# QA — simulasi command hashtag WA

Menjalankan tiap command hashtag WA terhadap DB nyata dan membandingkan teks
balasannya dengan yang diharapkan. 41 skenario: 15 command + varian argumen
kosong, format salah, kode tak ketemu, galat state machine, dan 5 uji
penembusan gerbang pengirim.

**Tidak pernah mengirim WA.** `WA_SEND_URL` dikosongkan (mode STUB) dan
`WA_DRY_RUN=true`.

## Kenapa ini ada

Command hashtag itu mahal diverifikasi manual: butuh baris `wa_message` dengan
pengirim yang benar, roster yang cocok, dan data transaksi pada tahap yang
tepat. Akibatnya gampang "diverifikasi" hanya dengan membaca string balasan di
kode — dan cacat yang cuma muncul saat dieksekusi lolos. Empat cacat nyata
ditemukan begitu 15 command ini benar-benar dijalankan (lihat PR fix
`inbound-hashtag-ketahanan`), termasuk `#KLAIM` yang menghilangkan klaim secara
permanen saat `services/ai` mati.

Teks balasan **tidak ada di return value** — `WaSendResult` sengaja hanya
membawa `{to, sent, stub}` dan pesan keluar tak disimpan ke DB. Satu-satunya
sumbernya adalah stdout `wasend.ts` mode STUB/DRY-RUN. Harness membajak
`console.log` dan memungut blok `--- pesan --- … --- selesai ---`.

## Jalankan

```bash
# 1. skema mutakhir
bash scripts/db/migrate.sh                       # --dry-run dulu utk lihat yg pending

# 2. fixture (idempoten, aman diulang)
psql -d wrg_os_dev -f scripts/qa/seed-hashtag-fixtures.sql

# 3. harness memuat apps/api/dist, jadi build dulu
pnpm --filter @wrg/api build

# 4. jalan
node scripts/qa/sim-hashtag.mjs                  # semua
node scripts/qa/sim-hashtag.mjs stok sph         # filter nama skenario
```

`DATABASE_URL` default `postgres:///wrg_os_dev`. Exit code 1 kalau ada skenario
tak cocok, jadi bisa dipakai sebagai gerbang manual.

**Bisa dijalankan berulang.** `resetState()` mengembalikan SJ dan approval
request ke tahap awal tiap kali mulai. Tanpa itu, run ke-2 gagal palsu (SJ sudah
terkirim, APR sudah disetujui) dan terbaca seperti regresi.

## Tidak dipasang di CI

Butuh Postgres ber-skema penuh + katalog `accurate_item`/`product_pricelist`,
jadi tak cocok untuk runner CI. Invarian yang **bisa** diuji tanpa DB sudah
dipisah ke tes murni yang ikut CI:

- `apps/api/src/repo/inbound-reply.test.ts` — balasan `#REPORT` AM
- `apps/api/src/repo/inbound-kind-filter.test.ts` — paritas daftar hashtag
  (`INBOUND_HASHTAGS` ↔ `detectKind` ↔ regex penyaring `processUnprocessed`).
  Ini yang menjaga kelas bug `#BUKTI`: hashtag dikenali detektor tapi hilang
  dari penyaring query, jadi pesannya dibaca benar lalu dibuang diam-diam.

## Fixture

Semua identitas berdiri sendiri supaya tak menyentuh baris nyata: `master_user`
`QA-AM-1`, `app_user` `hod@qa.invalid`, teknisi `Joko Fixture`, SJ `SJ-QA-00x`,
approval `APR-900x`. Nomor WA `62811100000x` — bukan nomor yang bisa dihubungi.

Empat gerbang pengirim yang diuji, masing-masing sumbernya **beda**:

| Command | Gerbang | Sumber |
|---|---|---|
| `#STOK` `#CEK` `#PRICING` `#SPH` | `resolveSender` | `master_user.wa_number` |
| `#install` `#servis` `#training` `#kalibrasi` | `matchTeknisiByName` | `teknisi_capacity.nama` (pushname) |
| `#APPROVE` `#REJECT` | `resolveApprover` | `app_user.wa_number` + `hod_key` |
| `#KLAIM` `#KIRIM` `#BAST` `#BUKTI` `#HELPDESK` | — sengaja terbuka | — |

`services/ai` distub di dalam harness (port `QA_AI_STUB_PORT`, default 8099)
supaya `#KLAIM` bisa diuji tanpa `.venv` FastAPI maupun kunci OpenRouter. Satu
skenario sengaja mengarahkan `AI_URL` ke port mati untuk memastikan
`services/ai` yang tak terjangkau dibalas sopan, bukan merobohkan batch.

## Catatan alur shipping

Rantai lapangan yang benar **bukan** `#KIRIM → #BAST`:

```
#KIRIM  →  (admin tandai TERIMA di web)  →  #BAST  →  #BUKTI
```

Langkah `terima` itu web-only (F42, Admin Shipping/Kirim-Tagih) dan tak punya
hashtag, jadi `resetState()` menyetelnya langsung. Lihat catatan KEDALUWARSA di
`docs/features/F12-tracking-pengiriman-digital.md`.
