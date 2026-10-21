# F96 — Cohort & Lead Source Analytics

**Menu:** Analytics → Kohort & Lead Source (`/kohort`) · **Migrasi:** tidak ada (hanya baca) · **Kunci izin:** `kohort` (view)

## Apa ini
Dua tab, dashboard saja (tanpa hashtag), hanya agregat:

1. **Retensi Customer** — kurva retensi per kohort kuartal Q1–Q4 dalam satu tahun. Kohort = kuartal faktur pertama customer di mirror Accurate (`accurate_invoice`, faktur bernilai positif). Kuartal +k = porsi customer kohort itu yang punya faktur lagi k kuartal kemudian (+0..+4).
2. **Lead Source** — pipeline `lead` (F65) per **sumber × status × kuartal**, plus rekap per HoD per semester (S1 = Q1–Q2, S2 = Q3–Q4) sebagai bahan menilai effort / NPK.

Keputusan Direktur (rapat 2026-10-19; klarifikasi sumber 2026-10-21): lima sumber = Tender, Referensi customer, Vendor lead, Trade show, Cold call; bandingkan per status per kuartal untuk menilai effort, terkait NPK.

## Pemetaan sumber (tanpa mengubah data)
| Sumber Direktur | `lead.source` |
|---|---|
| Tender | `lpse` |
| Referensi customer | `referral` |
| Trade show | `pameran` |
| Cold call | `telepon` |
| Vendor lead | *(tidak ada nilainya — tampil 0)* |
| Lainnya | `wa`, `web`, `lainnya` |

Vendor lead baru terisi bila `lead.source` kelak diberi nilai `vendor` (perubahan F65, belum dilakukan).

## Batasan yang ditampilkan di UI
- Data lead baru terkumpul sejak F65 (13 Okt 2026): kuartal sebelumnya kosong, bukan berarti tak ada lead.
- Kohort di kuartal pertama data mirror tak murni "customer baru" (diberi tanda `*`).
- Kuartal yang masih berjalan = data parsial (tanda `†`), tidak digambar di kurva supaya tak terbaca seperti churn.
- NPK: hanya rekap lead & konversi per HoD; **tidak mengubah skor NPK**.

## Akses
Fallback Direktur / admin / superuser / HoD (punya `hod_key`); matriks Akses Grup menang begitu fitur `kohort` diatur. Default tertutup untuk selain itu: butuh Sync Fitur + centang grup. Agregat saja, tanpa data per customer/lead.

## Teknis
- API `GET /kohort/retensi?tahun=` dan `GET /kohort/lead-source?tahun=` (repo `apps/api/src/repo/kohort.ts`; logika murni `susunRetensi`, `susunLeadSource`, `petaSumber` diuji di `kohort.test.ts`). BFF `apps/web/src/app/api/kohort/[tab]/route.ts` mengecek izin (`requireFeature("/kohort")`).
- Kuartal lead dihitung di WIB (`AT TIME ZONE 'Asia/Jakarta'`).
