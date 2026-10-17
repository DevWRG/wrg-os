# F31 — Tukar Faktur Tracker + Klinik Calendar (Fase 1)

| | |
|---|---|
| Menu | `/tukar-faktur` (kunci izin `tukar-faktur`; butuh Sync Fitur + centang grup Finance/AR) |
| API | `GET /tukar-faktur?hari=`, `GET /tukar-faktur/kalender?bulan=YYYY-MM` |
| Kode | `apps/api/src/repo/tukar-faktur.ts`, `apps/web/src/components/tukar-faktur/` |
| Migrasi | tidak ada (murni baca) |

## Keputusan Direktur (16 Okt 2026)
TTF diabaikan; status & data kalender "ikut Accurate"; reminder cukup di dashboard (tanpa WA, tanpa cron).

## Hasil probe Accurate (JAWABAN-BRIEF-ACCURATE-F31)
Tahap tukar faktur dan data kalender customer (jam buka, hari tanda tangan, PIC) **tidak ada di Accurate**
(0 dari 3.962 faktur memakai modul Tukar Faktur; field kustom header kosong; contact person 0/30 klinik).
Yang ada: faktur terbit, `printedTime` (dicetak), sisa tagihan (lunas), `dueDate`, `lastPaymentDateView`,
kategori pengadaan di `detailItem[].charField1`.

## Isi Fase 1
- **Tracker**: tahap Terbit → Dicetak → Lunas (status lunas = `deriveInvoiceStatus`, satu definisi dengan F91).
  Umur dihitung sejak tanggal cetak (cadangan: tanggal faktur); belum lunas dan umur **> 7 hari** (`HARI_TUA`) = TUA.
  Faktur lunas tidak punya umur/TUA. Badge kategori pengadaan (ECAT/KSO/PL/REGULAR/RUTIN).
- **Klinik Calendar**: jatuh tempo (belum lunas) dan tanggal bayar faktur customer klinik
  (`crm_account.tipe = 'Klinik'` atau nama diawali "klinik"). PIC = kontak utama `crm_contact` bila ada.
- Param salah → 400; tabel belum ada → 503 `migration_pending`; izin dicek di BFF (403).

## Batasan
- Mirror invoice hanya disegarkan untuk transDate ≤7 hari → faktur lama bisa tampak belum lunas.
- Format `printedTime` belum terverifikasi dari sampel; format tak dikenal → umur dari tanggal faktur.
- Titik awal umur 7 hari (QW3) belum dijawab Direktur; dipusatkan di `HARI_TUA` / `hitungTahap`.

## Fase 2 (menunggu Direktur)
Pencatatan tahap "dikirim" & "ditandatangani", serta jam buka / hari tanda tangan
(rencana: kolom di `crm_account`, migrasi baru).
