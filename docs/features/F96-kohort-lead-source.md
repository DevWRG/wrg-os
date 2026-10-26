# F96 — Cohort & Lead Source Analytics

**Menu:** Analytics → Kohort & Lead Source (`/kohort`) · **Migrasi:** tidak ada (hanya baca) · **Kunci izin:** `kohort` (view)

## Apa ini
Dua tab, dashboard saja (tanpa hashtag), hanya agregat:

1. **Retensi Customer** — kurva retensi per kohort kuartal Q1–Q4 dalam satu tahun. Kohort = kuartal faktur pertama customer di mirror Accurate (`accurate_invoice`, faktur bernilai positif). Kuartal +k = porsi customer kohort itu yang punya faktur lagi k kuartal kemudian (+0..+4).
2. **Lead Source** — pipeline lead per **sumber × status × kuartal**, plus rekap per HoD per semester (S1 = Q1–Q2, S2 = Q3–Q4) sebagai bahan menilai effort / NPK.

Keputusan Direktur (rapat 2026-10-19; klarifikasi sumber 2026-10-21): lima sumber = Tender, Referensi customer, Vendor lead, Trade show, Cold call; bandingkan per status per kuartal untuk menilai effort, terkait NPK.

## Sumber data & pemetaan sumber
Sejak 13 Okt 2026 #LEADS langsung jadi deal, jadi asal lead dicatat di **`deal.sumber_lead`** (migrasi 252, field "Sumber Lead" di form deal + detail pipeline). Tab ini menggabungkan: (1) deal ber-`sumber_lead` atau dibuat dari #LEADS (status dipetakan dari stage: Prospecting=baru, Closing-Won=dikonversi, Closing-Lost=ditolak, lainnya=dihubungi), dan (2) tabel `lead` lama (F65). Lead lama tidak ditelusuri ulang.

| Sumber Direktur | `deal.sumber_lead` | `lead.source` (lama) |
|---|---|---|
| Tender | `tender` | `lpse` |
| Referensi customer | `referensi` | `referral` |
| Vendor lead (principal/vendor merekomendasikan faskes) | `vendor` | *(tidak ada)* |
| Trade show | `pameran` | `pameran` |
| Cold call | `cold_call` | `telepon` |
| Lainnya | kosong (mis. #LEADS WA) | `wa`, `web`, `lainnya` |

WA/web = cara lead masuk, bukan asal lead, sengaja tidak dipaksa ke lima sumber. Bila baris Lainnya ternyata besar, evaluasi apakah pengguna perlu memilih sumber asli saat mencatat (keputusan Direktur). #LEADS WA belum punya sintaks sumber.

## Batasan yang ditampilkan di UI
- Data baru terkumpul sejak 13 Okt 2026 (F65 / deal dari #LEADS): kuartal sebelumnya kosong, bukan berarti tak ada lead.
- Kohort di kuartal pertama data mirror tak murni "customer baru" (diberi tanda `*`).
- Kuartal yang masih berjalan = data parsial (tanda `†`), tidak digambar di kurva supaya tak terbaca seperti churn.
- NPK: hanya rekap lead & konversi per HoD; **tidak mengubah skor NPK**.

## Akses
Fallback Direktur / admin / superuser / HoD (punya `hod_key`); matriks Akses Grup menang begitu fitur `kohort` diatur. Default tertutup untuk selain itu: butuh Sync Fitur + centang grup. Agregat saja, tanpa data per customer/lead.

## Teknis
- API `GET /kohort/retensi?tahun=` dan `GET /kohort/lead-source?tahun=` (repo `apps/api/src/repo/kohort.ts`; logika murni `susunRetensi`, `susunLeadSource`, `petaSumber` diuji di `kohort.test.ts`). BFF `apps/web/src/app/api/kohort/[tab]/route.ts` mengecek izin (`requireFeature("/kohort")`).
- Kuartal lead dihitung di WIB (`AT TIME ZONE 'Asia/Jakarta'`).
