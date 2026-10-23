# F63 — Weekly Briefing Direktur (Briefing Mingguan)

**Menu:** Overview → Executive Briefings → tab **Briefing Mingguan** (`/briefings?tab=mingguan`) · **Migrasi:** 245 (`briefing_mingguan`) · **Kunci izin:** ikut menu `/briefings` (tanpa kunci baru)

## Apa ini
Tiap **Senin 07:00** sistem membaca **rekap + resume** (`monitor_digest`) minggu ISO yang baru tutup (Senin–Minggu lalu), meminta LLM menyusun **briefing untuk minggu yang baru mulai** (format A–H: ringkasan, sales & pipeline, operasional, action item carry-over, agenda, proyeksi, keputusan, executive summary), menyimpannya per minggu, lalu mengirim ke Direktur **LINK** ke tab ini lewat WhatsApp. Isi briefing tidak ikut di WA.

Keputusan Direktur (rapat 2026-10-19) menggantikan brief awal "auto-send email": channel = WA berupa link; kerangka = prototype briefing weekend yang sudah ada.

## Beda dari briefing weekend & Senin Brief
- `weekendbriefing.ts` (Sabtu/Minggu 07:00, `monitor_digest kind='briefing'`, tanpa WA) **tetap jalan**, tidak diubah.
- Senin Brief F85 (Senin 06:30) menilai kesiapan 8 HoD dari angka WatchPoint; F63 menyintesis **percakapan** (rekap/resume) menjadi bekal minggu depan. Dua tab berdampingan.

## Perilaku
- Generate ulang minggu yang sama **menimpa** barisnya (UNIQUE `iso_year, iso_week`); `briefing_mingguan.n_rekap/n_resume` mencatat jumlah dokumen dasar.
- Tak ada rekap/resume di minggu dasar → tidak ada baris, tidak ada WA (error dicatat di log job).
- Narasi LLM gagal / dry-run → baris tersimpan berisi catatan (`narasi_ok=false`) dan **WA TIDAK dikirim**.
- Label periode dipaksa kanonik setelah LLM (anti-halusinasi "Minggu N").
- Tiap dokumen digest dipotong 6.000 karakter di prompt.

## Konfigurasi (env)
| Env | Default | Fungsi |
|---|---|---|
| `WEEKLY_BRIEFING_ENABLED` | `false` | Menyalakan job (tak ikut `AGENT_SCHEDULE_ENABLED` karena mengirim WA) |
| `WEEKLY_BRIEFING_CRON` | `0 7 * * 1` | Jadwal (WIB); Senin libur dilewati |
| `WEEKLY_BRIEFING_TARGET` | kosong → akun Direktur | Tujuan WA. **Uji dev: isi dengan grup riset.** Produksi: kosongkan (Direktur) |
| `WEB_PUBLIC_URL` | — | Dasar link; kosong = tak ada yang bisa dikirim |

Pengiriman patuh `WA_DRY_RUN` dan allowlist `WA_SEND_ALLOWED_TARGETS`.

## Teknis
- API: `GET /weekly-briefing` (read model, 12 minggu terakhir); `POST /weekly-briefing/run` (body `{dry_run?, kirim_wa?, iso_year?, iso_week?}`, **default dry-run & tanpa WA**, tanpa route BFF).
- Repo `apps/api/src/repo/weekly-briefing.ts` (murni diuji: `jendelaBriefing`, `labelBriefing`, `formatWaLink`, `potongDok`); AI: `services/ai` `/weekend-briefing` dengan field baru `mode="senin"` (default `weekend` = perilaku lama).
- Nomor tujuan WA tidak diekspos ke web.
