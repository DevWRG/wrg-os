# F4 SXR — Pipeline Authenticity (Keaslian Pipeline)

Tab **Keaslian Pipeline** di Sales Analytics: apakah deal di Pipeline mencerminkan aktivitas nyata. Issue #1784.
Tanpa migrasi, tanpa menu baru (izin Sales Analytics). Ber-scope sama dengan Pipeline: AM = deal miliknya,
HoD = cabang yang dipegang. Per hari ini — tidak ikut filter tanggal tab lain.

## Keputusan user (17 Okt 2026)

Tab di Sales Analytics · empat sinyal · deal tanpa akun dicocokkan lewat nama · **tanpa WA**.

## Aturan (deterministik, bukan LLM)

| Sinyal | Aturan | Tingkat |
|---|---|---|
| Tanpa kunjungan | tak ada laporan kunjungan (`activity_log`) ke faskes/deal 60 hari | perlu cek |
| Macet di tahap | lama di tahap > Prospecting/First Contact 60 · Presentation/Quotation/Offering 45 · Negotiation 30 · Closing 14 hari; `on_hold` dikecualikan | perlu cek |
| Kunjungan tanpa bukti | ada kunjungan 60 hari, tak satu pun berfoto + bergeotag | perlu cek |
| Won tanpa faktur | Closing-Won ≤180 hari, > 60 hari sejak Won, tanpa faktur Accurate ke faskes itu sejak (Won − 30 hari) | **meragukan** |

**Meragukan** = Won tanpa faktur, ATAU tanpa kunjungan + macet sekaligus. **Perlu dicek** = sinyal lain. Info (tak
menurunkan status): belum tertaut akun, menunggu faktur (Won ≤60 hari), deal ditahan, **belum pernah pindah tahap
sejak dibuat** (>60 hari).

## Pencocokan

- Deal → faskes: `account_id`; kalau kosong, penaut `akun-faskes.ts` (sama dengan #REPORT; ambigu = tak ditautkan).
  Prod 17 Okt: 219/224 deal tanpa akun memang **calon pelanggan** (belum di Accurate) — wajar tak tertaut.
- Kunjungan → deal: `account_id`, `opportunity_id`, nama persis, ATAU **kata nama** (`kunjunganCocok`): laporan AM yang
  SAMA memuat semua kata inti nama faskes deal & jenis (RS/PKM/…) tak bertentangan; nama tanpa kata inti
  ("Puskesmas", "Dinas Kesehatan") tak dicocokkan.

## Angka prod 17 Okt (SELECT saja, ±380 ms)

522 deal (377 terbuka + 145 Won ≤180 hr) → **184 meragukan** (est. Rp 4,22 M) · 138 perlu cek · 200 terverifikasi.
Alasan: macet 271 · tanpa kunjungan 191 · tanpa bukti 19 · Won tanpa faktur 16. Dua AM menonjol (Ari Kurnia Yuda
48/53, Dodi Alvian 41/45): seluruh deal mereka dibuat sekaligus **30 Jul 2026** (impor awal go-live CRM) dan tak pernah
pindah tahap — pipeline basi, bukan fiktif; diberi keterangan "belum pernah pindah tahap sejak dibuat".

SPH (`sales_doc`) di prod kosong → tak dipakai sebagai sinyal. Jarak geotag vs lokasi faskes belum dicek (koordinat
faskes tak ada).

## API

`GET /sales-analytics/keaslian` (x-user-id → scope) lewat BFF catch-all `/api/sales-analytics/[...path]`.

## Berkas

`apps/api/src/repo/pipeline-keaslian.ts` (+ test) · `apps/api/src/index.ts` ·
`apps/web/src/components/sales-analytics/keaslian-view.tsx` · `sales-analytics-dashboard.tsx`
