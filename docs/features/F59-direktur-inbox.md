# F59 — Direktur Inbox (CROSS)

Satu daftar untuk semua antrean approval yang **menunggu keputusan Direktur**, plus
digest WA pagi. Sebelumnya Direktur harus membuka satu per satu menu PO, dana
operasional, insentif, approval F11, dan lembur.

- **Domain**: CROSS · Hashtag — · FR-ES-59 · R1 · MUST · Sprint B1
- **Owner (board)**: Direktur
- **Menu**: `/direktur-inbox` ("Direktur Inbox", di samping Executive Briefings)
- **Migrasi**: tidak ada (membaca tabel yang sudah ada; anti-dobel digest di `notif_state`)
- **Murni BACA.** Tidak ada jalur tulis approve baru — memutuskan tetap lewat layar/WA
  tiap sumber, yang aturan wewenangnya berbeda-beda.

## 1. Apa yang dianggap "menunggu Direktur"

| Jenis | Aturan | Tautan | Balasan WA |
|---|---|---|---|
| Approval F11 | `approval_request` pending, tahap aktif (`current_urutan`) ber-`target_type='direktur'` | `/approval-requests/{id}` | `#APPROVE {kode}` |
| Purchase Order (F35) | tier-1 (HoD Business + HoD Finance) approved, Direktur pending, tak ada yang menolak. **Dikecualikan**: PO tanpa `lini` (pra-F35), `source='accurate'` (approval di Accurate), PO batal | `/purchase-orders?q={po}` | — |
| Dana Operasional (F138) | HoD approved, Direktur pending | `/fund-requests` | — |
| Insentif (F67) | rekap yang sedang di langkah ber-`group_key='direktur'` di `insentif_approval_step` (saat ini `corsec_compile`). `direktur_approve` = SUDAH disetujui Direktur (giliran HRD), tidak tampil | `/insentif/tim/{amId}?periode=` | — |
| Lembur | `overtime_request` pending **dan** `hod_key IS NULL` (tak ada HoD pemutus) | `/overtime` | `#APPROVE {OT-kode}` |

Nilai PO = `purchase_order.total_amount`, fallback Σ(`unit_price × qty_ordered`).
"Menunggu sejak" = saat tahap Direktur dimulai (notifikasi tahap F11, keputusan HoD
terakhir untuk PO/Dana, riwayat langkah untuk Insentif); fallback tanggal dibuat.

**Sengaja di luar scope**: Doc Klaim (bisa diputus HoD pengaju *atau* Direktur — belum
ada aturan tegas), Audit Finding (wewenang berbasis grup akses, chain default mati),
Deal-loss (HoD cabang), serta "harga / faktur / alokasi" dari kartu (belum punya
alur approval sama sekali). Menambah sumber = satu fungsi di `repo/direktur-inbox.ts`
+ satu baris di `SUMBER` + `LABEL_JENIS`/`LABEL` di web.

Satu sumber yang gagal dibaca **tidak** menjatuhkan inbox: item sumber lain tetap
tampil dan halaman menampilkan banner "daftar belum lengkap" (`gagal` di respons).

## 2. Halaman & API

- `GET /direktur-inbox` → `{generated_at, total, per_jenis, items, gagal}`; item tertua dulu.
- Web: `/direktur-inbox` — filter per jenis, cari, urut, export CSV; umur > 3 hari merah.
- Izin: kunci `direktur-inbox`. Fallback identitas = role `direktur` / `admin` / `superuser`
  (HoD **tidak**). Gate di halaman **dan** BFF (`/api/direktur-inbox`): service-token
  mem-bypass JWT di API, jadi menyembunyikan menu saja tidak menutup endpoint.
- **Setelah deploy**: jalankan **Sync Fitur** lalu centang `direktur-inbox` untuk grup
  Direktur. Begitu grup punya baris izin, matriks Akses Grup yang menang atas fallback.

## 3. Digest WA pagi (flag MATI)

`direktur-inbox` di scheduler — `DIREKTUR_INBOX_ENABLED=false` default, `DIREKTUR_INBOX_CRON`
default `30 7 * * 1-5`, dilewati di hari libur. Flag sendiri (tak ikut `AGENT_SCHEDULE_ENABLED`).

- Isi: hitungan per jenis + 10 item tertua + "dan N lainnya" + petunjuk
  `#APPROVE <kode>` / `#REJECT <kode> alasan` (hanya bila ada item F11/lembur) + link web.
  Dipotong ≤ 3500 karakter (`wasend.ts` tak punya batas).
- Inbox **kosong → tidak dikirim**. Isi sama di hari yang sama → tidak dikirim ulang;
  hari baru dengan antrean yang belum diputus → dikirim lagi (memang pengingat).
- Target: `DIREKTUR_INBOX_TARGET` → fallback nomor `app_user` Direktur tertua yang punya WA.
  **Target broadcast ditentukan user** — jangan dinyalakan sebelum diputuskan.
- Pengiriman patuh `WA_DRY_RUN`.
- Manual: `POST /direktur-inbox/run` dengan `x-service-token` — **default `dry_run=true`**
  (mengembalikan `wa_preview`, tanpa kirim, tanpa menulis `notif_state`); kirim sungguhan
  harus `{"dry_run": false}`. Sengaja tanpa route BFF.

"Tombol approve" di kartu **tidak** dibuat: WA tak punya tombol. Penggantinya link
dashboard + balasan `#APPROVE` yang sudah didukung parser untuk F11 & lembur.
