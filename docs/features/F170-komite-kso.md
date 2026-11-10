# F170 — Komite KSO: Rencana KSO, tujuh gerbang, forum & mandat

Setiap rencana KSO diajukan AM lewat WhatsApp (`#KSO`), dinilai tujuh gerbang berangka, lalu diputus
dalam waktu kurang dari 24 jam: oleh dua HOD bila semua gerbang hijau (jalur cepat), atau oleh Direksi
atas usulan forum Selasa/Kamis 16.00 (jalur forum). Penawaran hanya terbit setelah ada **mandat
negosiasi** dengan harga lantai.

- **Domain**: CRM · issue #1762 · sumber: Paket Komite KSO v1.0 (Direktur, 15 Okt 2026)
- **Menu**: `/kso-komite` — satu menu, tab per peran (lihat Izin)
- **WA**: `#KSO` (bot yang sudah ada, openclaw) — saklar `KSO_WA_ENABLED`
- **Jadwal**: scheduler API — saklar `KSO_JADWAL_ENABLED`
- **Migrasi**: 224–233, 242 (schema `kso` + `public.kso_komite_jabatan/_pemegang`; tidak menyentuh tabel OS yang sudah ada)
- **Uji**: `scripts/qa/kso-komite/jalankan_uji.sh` (Postgres sekali pakai) — 184 uji

## Tahapan

| Tahap | Isi | PR |
|---|---|---|
| T1 | schema `kso` (224–226 = rujukan apa adanya) + hak akses versi WRG-OS (227) | #1763 |
| T2 | isi referensi dari data OS — `kso.segarkan_referensi()` (228) | #1766 |
| T3 | intake WhatsApp `#KSO` + voice note, ekstraksi LLM tersaring (229) | #1769, #1770 |
| T4 | layar per peran dari Akses Grup (230) | #1775 |
| T5 | jadwal forum & notifikasi, batas HOD hari kerja (231) | #1778 |
| T6 | label sumber volume + KPI tanpa nol palsu (232); pemetaan KPI → NPK/insentif (dokumen ini) | — |
| T7 | siap pakai (daftar periksa di bawah) | — |
| S1 | tab Sekretariat + pencocokan PKS penuh + Susunan Komite dari UI (242) — deck orientasi Direktur 20 Okt | #1839 |

## Keputusan user

| Tgl | Keputusan |
|---|---|
| 16 Okt | Ikut infra & techstack WRG-OS, **bukan** Supabase/n8n/Refine/Metabase seperti asumsi paket |
| 16 Okt | Grup mitra (SK Pasal 14/16): dibiarkan kosong dulu, dilaporkan ke Direktur — OS tak punya data grup |
| 16 Okt | **SBY 1 = office**: tanpa HOD Area → usulan SBY 1 langsung forum, pendapat dari HOD Business IVD. `hod_territory` OS tidak diubah |
| 16 Okt | Nomor WA bot yang sekarang (bukan nomor baru); voice note diterima; **semua perintah lewat `#KSO`** (`#KSO kirim D12`, bukan balasan polos "kirim" — bentrok `#KIRIM` & "kirim R12") |
| 16 Okt | Peran Komite/Direksi/Admin Sales/Teknik diatur di **Akses Grup** (bukan daftar di `kso.pengguna`) |
| 16 Okt | **Aspek KSO NPK 2026 tetap kosong** sampai SK AM 2027 (lihat Pemetaan KPI) |
| 21 Okt | **Sekretaris Komite** menerbitkan penawaran, mencocokkan PKS, mencatat hasil; **tidak menilai** (tanpa tombol Usulkan). Catat PKS **pindah total** dari Direksi; tab Penawaran (admin_sales) tetap sebagai cadangan |
| 21 Okt | **Nama orang tidak di kode**: jabatan Komite & pemegangnya diisi dari panel Susunan Komite (izin `kso-komite-susunan`; role admin tidak otomatis) |
| 17 Okt | Akun HOD di prod tanpa `hod_key` → tautan khusus KSO `kso.hod_akun` (migrasi 233), **bukan** mengisi `app_user.hod_key` (yang ikut membatasi cakupan semua menu) |

## Beda dari paket rujukan (sengaja, semua diuji)

| # | Rujukan | WRG-OS | Alasan |
|---|---|---|---|
| 1 | `auth.uid()` Supabase, role anon/authenticated/service_role | GUC transaksi `wrg.kso_user/peran/ref` diisi API; `wrg_app`; `service_role` dihapus | stack WRG-OS; job pakai akun mesin `job-jadwal` |
| 2 | Register teknisi kosong → gerbang 3 **merah** "tidak ada teknisi" | **belum bisa dicek** | data belum ada ≠ klaim tak ada teknisi |
| 3 | `buat_draft` mengisi jumlah = 1; klausul `'{}'` = "tidak ada" (gerbang 7 hijau) | keduanya wajib **dinyatakan** AM sebelum `#KSO kirim` | aturan "tidak ada nilai bawaan" |
| 4 | Batas putusan HOD 24 jam | **1 hari kerja** (Sabtu/Minggu & `master_holiday` dilewati) | spesifikasi "maks. 1 hari kerja" |
| 5 | Jejak status mencatat label peran ("direksi") | + `oleh_user`/`oleh_peran` (siapa orangnya) | audit |
| 6 | Klausul khusus & ambang di data contoh | dimuat migrasi (aturan bisnis) | mesin tak jalan tanpa keduanya |

## Izin (Akses Grup)

| Tab | Kunci fitur | Peran DB | Gate lama (sebelum diatur di matriks) |
|---|---|---|---|
| Rencana Saya | `kso-komite` | am (am_id) | punya `am_id` |
| HOD | `kso-komite-hod` | hod (hod_key) | punya `hod_key` |
| Agenda Forum | `kso-komite-agenda` | komite | — tertutup |
| Putusan Direksi | `kso-komite-direksi` | direksi | role `direktur` |
| Sekretariat | `kso-komite-sekretariat` | sekretaris | — tertutup |
| Penawaran (cadangan) | `kso-komite-penawaran` | admin_sales | — tertutup |
| *(panel)* Susunan Komite — ubah | `kso-komite-susunan` | — (API, tabel public) | — tertutup; superuser lolos, role admin tidak |
| Jadwal Pasang | `kso-komite-teknik` | teknik | — tertutup |
| KPI AM | `kso-komite-kpi` | komite | — tertutup |

Izin diperiksa di BFF **dan** di API (`repo/kso-komite.ts` `putuskanIzin` = replika `canOrLegacy`), lalu
transaksi `SET LOCAL ROLE wrg_app` + GUC peran → RLS & `kso.wajib_peran` tetap berlaku. **Jebakan:** API dev
konek sebagai superuser (socket) — tanpa `SET LOCAL ROLE` pagar database terlewati di dev.

## Pemetaan KPI → NPK & insentif (Tahap 6)

Feed: `kso.v_kpi_am` (per AM per kuartal), tampil di tab **KPI AM**. Kosong = "belum ada data", bukan 0.

| Metrik (`v_kpi_am`) | Slot OS sekarang | Rencana |
|---|---|---|
| `capex_ditempatkan`, `capex_terverifikasi` | NPK aspek **KSO Penetration (15)** — SK/WRG/Sales/001/V/2026 Tabel 4 = **jumlah** KSO aktif ÷ target | **Tetap kosong di NPK 2026** (keputusan 16 Okt): target KSO per AM tak ada di OS, 61 kontrak "lewat" belum diverifikasi (penalti −10/kontrak = menghukum data kotor), dan paket minta basis capex — untuk SK AM 2027 |
| `akurasi_volume_median` (bulan-6) | — | SK AM 2027: komponen KSO 40% (usulan paket 9.5) + pengali insentif deal |
| `kelengkapan_pertama_persen` | — | SK AM 2027: 15% |
| `realisasi_harga_rata` (harga PKS ÷ lantai) | — | SK AM 2027: 15% + pengali harga insentif deal |
| Piutang KSO > 60 hari | NPK aspek **AR (10)** sudah menghitung AR > 45 hari | tidak dibuat metrik baru |
| `usulan_*`, `sumber_data_persen`, `flag_pemecahan_paket` | — | tampil saja, **tidak** diskor (anti mengejar jumlah / memecah paket) |
| — | Insentif reguler F67 (`is_kso` per faktur) | tidak diubah |
| — | Insentif deal (paket 9.6) | menunggu skema (butir C6); basis siap: `v_kpi_am` + `kso.verifikasi_bulan6` |

`sumber_data_persen` dari `volume_sumber_label` — label TURUNAN (`kso.tebak_label_sumber`, aturan kata
kunci; ragu → NULL), kalimat asli AM tak pernah ditimpa; koreksi manusia (`volume_sumber_label_manual`) tak
ditimpa mesin.

## Data yang belum ada di OS (gerbang → "belum bisa dicek" → forum)

| Data | Gerbang | Butir permintaan |
|---|---|---|
| Harga standar per test per kategori | 2 | C10 |
| Register sertifikasi teknisi per cabang × kategori | 3 | — |
| Grup mitra + rating + kelengkapan PKS | aturan SK 14/16 | — |
| HPP mesin untuk Wondfo CLIA, LIBO, RedCell, AH600pro, PT1000 | alat tak bisa diajukan | — |
| Kota 16 faskes tak ada di `area_kota` | 3 (di luar coverage) | — |

Selama C10 & register teknisi kosong, **semua** usulan masuk forum.

## Tahap 7 — daftar periksa sebelum prod

- [ ] Direksi memutus 5 keputusan pemblokir + 9 lainnya (sheet Keputusan Direksi, RACI v1.0) → `UPDATE kso.parameter`
- [ ] Harga Z52/EXZ8000: HPP price book (83,5 / 334 jt) vs PO Direktur (77 / 267,2 jt) — pilih basis capex
- [ ] Promosi dev → main (migrasi 224–232 auto-apply di prod) — satu fitur per PR
- [ ] **Sync Fitur** di prod (7 kunci tab) → centang per grup di Akses Grup
- [ ] Nomor WA HOD terisi (`waHod`: app_user ber-hod_key atau master_user HOD) — di dev Mufid tanpa nomor
- [ ] Jalankan `select kso.segarkan_referensi()` sekali di prod (selanjutnya job `kso-segarkan-referensi` 01.30 tiap malam)
- [ ] `KSO_WA_ENABLED=true`, lalu `KSO_JADWAL_ENABLED=true` (prod)
- [ ] Forum pertama tidak membahas usulan baru (SK Pasal 17) — uji alur dengan 2–3 usulan nyata
- [ ] Data contoh (`scripts/qa/kso-komite/004`) TIDAK pernah dimuat ke prod

## Sekretariat & Susunan Komite (S1, migrasi 242)

**Pencocokan PKS** (`kso.cocokkan_pks`, pembungkus `kso.app_cocokkan_pks` peran `sekretaris`). Isian dari
naskah PKS — harga per test, tenor, volume minimum, klausul yang ada. Ditolak bila:

| Cek | Galat |
|---|---|
| tidak ada mandat / mandat kedaluwarsa | `TIDAK_ADA_MANDAT` / `MANDAT_KEDALUWARSA` |
| harga < batas bawah | `KELUAR_MANDAT` |
| tenor > `mandat.tenor_maks_bulan` | `PKS_TIDAK_COCOK: tenor …` |
| volume < `mandat.volume_minimum` | `PKS_TIDAK_COCOK: volume …` |
| salah satu `mandat.klausul_wajib` (kenaikan harga tahunan, lapor jumlah test, denda telat bayar) tak ada | `PKS_TIDAK_COCOK: perlindungan wajib hilang …` |
| ada klausul di `mandat.klausul_dilarang` | `PKS_TIDAK_COCOK: klausul dilarang mandat …` |
| ada klausul khusus RS yang tak pernah diusulkan (`rencana_klausul`) | `PKS_TIDAK_COCOK: klausul di luar usulan …` |

Pembungkus lama `kso.app_catat_pks` (harga saja) **dicabut** supaya tak ada jalan pintas. Isi PKS
disimpan di `rencana_kso.pks_tenor_bulan / pks_volume_minimum / pks_klausul`.

**Susunan Komite**: `public.kso_komite_jabatan` (6 jabatan awal, label saja) + `public.kso_komite_pemegang`
(satu pemegang aktif per jabatan — indeks unik `selesai is null`; ganti orang = tutup baris lama + baris baru).
Agenda WA 14.00 menulis Ketua (`ketua_kso`) & Sekretaris (`sekretaris_kso`) dari sini; jabatan kosong tidak
ditulis. Penawaran pagi dikirim ke pemegang centang Sekretariat **dan** Penawaran (satu pesan per nomor).

Setelah ke prod: **Sync Fitur** (2 kunci baru: `kso-komite-sekretariat`, `kso-komite-susunan`) → centang
per grup → isi Susunan Komite dari layar.

## Format WA sembilan isian + FEE + lampiran PDF Simulator (migrasi 302, 10 Nov 2026)

Keputusan product owner: usulan baru HANYA lewat format berlabel (pengurai deterministik `apps/api/src/repo/kso-format.ts`,
tanpa LLM). Jalur teks bebas (`/kso/ekstrak`) dan voice note dimatikan di API (audio ditandai `kso-suara-nonaktif`, tanpa balasan).

```
#KSO BUDI                      ← nama pengirim sendiri (dicocokkan ke nama/panggilan master + pushname)
1. FASKES : RS CONTOH
2. ALAT : ZYBIO Z50            ← pencarian alat: kode utuh / O↔0 / "Z 50" / merek + angka / kategori → 1 pasti atau 3 saran
3. TES : 700 TEST/BULAN
4. MASA KSO : 36 BULAN
5. PERMINTAAN HARGA : 11.800/TEST
6. FEE : 5%                    ← GPM dari harga × (1 − fee); harga minimum per zona = harga kotor biaya÷(1−g)÷(1−fee)
7. KOMPETITOR : MEREK-MODEL-11.500
8. KLAUSUL : ADA - isinya      ← detail tak dikenali = kode 'lainnya' (gerbang 7 merah)
9. LAMPIRAN : ADA              ← PDF Simulator KSO di chat yang sama ±10 menit (pengirim sama, urutan bebas)
```

- Susulan: `#KSO D62 LABEL: isi` (PENDUKUNG, STATUS UNIT, ALASAN, KLAUSUL, HARI KERJA, JUMLAH, SUMBER, atau salah satu dari 9 label).
- Alat tak pasti → draft BELUM dibuat (alat_kode NOT NULL + FK); isian disimpan di `kso.intake_tertunda`, AM memilih `#KSO ALAT 1` / `#KSO ALAT: Z50` (24 jam).
- PDF dibaca `services/ai /kso/ocr-cprr`, dicocokkan (sales, faskes, alat, tes/bulan, masa, merek kompetitor), disimpan di `kso.rencana_lampiran`.
  Cocok → hari kerja + sumber volume "Lampiran Simulator KSO <tanggal>" (label `data`; Sekretariat tetap verifikasi untuk Forum).
  Koreksi isian lewat WA memicu pencocokan ulang lampiran terakhir (tak perlu kirim PDF ulang).
- Wajib sebelum diajukan (satu daftar `daftarKurang`, dipakai WA + dashboard): 9 isian + pendukung ≥ 1 bertipe + status unit +
  bukti volume + alasan strategis (zona Direktur, kecuali HD) + detail klausul (bila ADA) + lampiran cocok.
  Lengkap → diajukan OTOMATIS (sama dengan `#KSO kirim`, termasuk notifikasi HOD). `#KSO kirim D62` menolak bila masih kurang.
- Dashboard API: `GET /kso-komite/:tab/daftar/belum-lengkap|lolos-tanpa-forum`, detail rencana memuat `fee_persen`, `harga_bersih`,
  `lampiran_terakhir`, `lampiran[]`, `kurang[]`; berkas PDF `GET /kso-komite/:tab/rencana/:id/lampiran/:lid` (izin tab + RLS).
- Uji: `scripts/qa/kso-komite/918_uji_fee_lampiran.sql`, `apps/api/src/repo/kso-format.test.ts`.

## Balasan WA = 7 gerbang · margin & HPP tak terlihat di luar yang berhak (10 Nov 2026)

Keputusan product owner. **A.** Semua balasan WA ke AM yang menunjukkan keadaan draft (baru, susulan, lampiran
diproses, `#KSO D62`, `#KSO kirim` yang masih kurang) memakai SATU bentuk (`formatBalasanGerbang`, `kso-intake.ts`):

```
D63 · RS CONTOH · Z50 · 4/7 HIJAU

1. GPM deal              ❌ MERAH
2. Volume terbukti       ❌ MERAH (belum ada bukti)
3. Relokasi dulu         ✅ HIJAU
4. Coverage + teknisi    ❌ MERAH (belum ada data)
5. Piutang faskes        ✅ HIJAU
6. Tenor                 ✅ HIJAU
7. Klausul standar       ✅ HIJAU

Kurang: lampiran PDF, pendukung, status unit, alasan
(contoh: #KSO D63 lalu kirim PDF-nya dalam 10 menit)
```

Biner: `hijau` = ✅ HIJAU; `merah` dan `belum` = ❌ MERAH + alasan pendek TANPA angka (`alasanGerbang`, `kso-saring.ts`);
gerbang 1 merah tanpa alasan; KLAUSUL belum dijawab = gerbang 7 MERAH. Lengkap & diajukan otomatis → baris Kurang
diganti hasil jalur dalam kata (`teksHasilAjukan`: ZONA AM / ZONA 2 HOD / ZONA FORUM / ZONA DIREKTUR, tanpa GPM/harga).

**B.** Margin & HPP hanya untuk **HOD Business, Komite, Sekretariat, Direksi** (+ superuser, role admin/direktur,
Finance pengisi angka Bottom Line). TIDAK untuk **AM, HOD Sales, Admin Sales, Teknik**.

- WA ke AM: tanpa GPM %, biaya/tes, cicilan/HPP, harga minimum per zona, volume minimum Forum, dasar GPM, CPRR
  (baris "CPRR vs permintaan harga" dihapus dari `cocokkanLampiran`), harga mandat (zona AM, `#KSO D12 volume 900`).
- WA ke kursi HOD Sales (`kso.hod_untuk` jenis `area`) dan Admin Sales (pagi penawaran): tanpa capex.
  HOD Business & Sekretariat tetap menerima capex.
- API (bukan hanya layar) — `modeSaringTab` (`kso-komite.ts`) + penyaring murni `kso-saring.ts`, untuk
  `GET /kso-komite/:tab`, `/:tab/rencana/:id`, `/:tab/daftar/:filter`:
  - tab `saya` (AM): selalu disaring;
  - tab `hod`, `penawaran`, `teknik`: disaring kecuali akunnya berhak (`bolehLihatAngka`);
  - kolom dibuang: `capex`, `capex_disetujui`, `payback_bulan`, `biaya_instalasi`, `gpm_deal`, `zona_dasar`, `harga_bersih`,
    `angka_gpm` (→ null), harga mandat (`harga_pembuka`/`harga_target`/`harga_lantai`/`capex_maks`; Admin Sales tetap
    menerima `harga_pembuka` = harga di penawaran yang mereka terbitkan), `usulan[].mandat_usulan`, isian OCR biaya
    (`capex_total`, `capex_per_test`, `reagen_per_test`, `qc_per_test`, `base_cost_per_test`, `cprr_per_test`, `markup_persen`),
    peringatan OCR yang menyebut biaya; nilai gerbang 1 → "Memenuhi" / "Belum memenuhi …". Respons diberi `tanpa_angka: true`.
  - berkas PDF Simulator (`/:tab/rencana/:id/lampiran/:lid`) → 403 untuk tab yang disaring (PDF memuat capex/reagen/CPRR).
- Bottom Line Alat & Tinjauan Portofolio: `izinBottomLine(u, eff, konteks)` menolak AM, HOD Sales, Admin Sales walau
  grupnya dicentang `kso-komite-bottomline` lihat (ditegakkan di kode).
- **Jenis HOD** = `kso.hod.jenis` (`bisnis` = HOD Business, `area` = HOD Sales), diisi malam oleh `kso.segarkan_referensi()`
  dari `master_hod.peran` ("Business …" / "Sales …"). Kursi akun = `app_user.hod_key` **dan** `kso.hod_akun.hod_id`
  (keduanya dibaca; memegang kursi Business = boleh). Kursi tak dikenal = disaring (tertutup).
- Uji: `apps/api/src/repo/kso-saring.test.ts`, `kso-intake.test.ts` (penjaga `polaTerlarang`), `kso-jadwal.test.ts`.

## Faskes baru (calon customer) dari #KSO (migrasi 303, 10 Nov 2026)

Keputusan product owner: nama faskes di `#KSO` tidak harus faskes yang sudah ada — bisa customer/faskes baru.
Keputusan faskes untuk usulan baru (`putuskanFaskes`, `kso-format.ts`; dipanggil `cariFaskesBot`, `kso-intake.ts`):

| Hasil pencarian | Tindakan |
|---|---|
| Pasti ke satu faskes master (`cariAkun` → satu `kso.faskes`), atau nama persis sama dengan faskes baru yang belum ditautkan | dipakai |
| Mirip tapi tidak pasti (salah ketik / ambigu; skor ≥ `SKOR_FASKES_MIRIP` 0,5 atau nama yang disebut `cariAkun` ambigu) | draft BELUM dibuat; isian disimpan di `kso.intake_tertunda` (24 jam); balasan maks 3 pilihan + `#KSO FASKES 1` / `#KSO FASKES BARU` / `#KSO FASKES: NAMA` |
| Tidak ada yang mirip | faskes SEMENTARA dibuat langsung, draft jalan |

- Faskes sementara: `kso.faskes` id `BARU-<n>`, `baru = true`, cabang = cabang AM, piutang/tagihan 0 (gerbang 5 hijau
  "Faskes baru — belum ada tagihan"), `kota` dari label opsional `KOTA:` (atau `#KSO D64 KOTA: …`) atau dari PDF Simulator,
  `dibuat_oleh_am`, `dibuat_at`. Nama sama (tanpa beda huruf besar/spasi) dipakai ulang, tidak digandakan. Tulis hanya lewat
  `kso.app_bot_buat_faskes_baru` / `kso.app_bot_isi_kota_faskes` (peran bot_wa, pola 227).
- Isian tertunda menampung alat DAN faskes: `faskes_id` kosong + `faskes_saran` berisi = faskes ditanya; `faskes_id` kosong tanpa
  pilihan = faskes baru dibuat saat draft jadi; `alat_kode` kosong = alat ditanya. Urutan: faskes dulu, lalu alat
  (`pertanyaanTertunda`). PDF yang dikirim bersama pesan asli disimpan (`lampiran_wa`/`lampiran_path`) dan diproses saat draft jadi.
- Balasan: `D64 · RS UJI COBA (faskes baru) · Z3 · 5/7 HIJAU` + catatan "dicatat sebagai FASKES BARU (calon customer)". PDF:
  nama faskes PDF dicocokkan ke nama yang ditulis AM (= nama faskes sementara); kota kosong diisi dari PDF.
- `kso.segarkan_referensi()` tidak diubah: hanya meng-upsert id = `crm_account.account_id`, tak pernah menghapus → baris `BARU-…`
  tak tersentuh. CHECK `faskes_baru_id_ck` (`baru ⇔ id 'BARU-%'`). Konsumen `faskes_id` lain (231 bulan-6, 280 mandat untuk
  deal) membandingkan teks → faskes sementara tak cocok ke akun mana pun sampai ditautkan.
- Tautkan ke akun master (Sekretariat / Komite, tab `sekretariat`/`agenda`): `POST /kso-komite/rencana/:id/tautkan-faskes {akun}`
  → `kso.app_tautkan_faskes`: semua usulan + isian tertunda pindah ke akun master, baris sementara menyimpan `ditautkan_ke/at/oleh`,
  gerbang draft terbuka dihitung ulang (usulan yang sudah diajukan tidak). Akun master harus sudah ada di `kso.faskes`
  (customer baru masuk sesudah penyegaran malam). Detail rencana memuat `faskes_saran_master` (5 akun termirip) untuk tab itu.
- Dashboard: `faskes_baru` + `faskes_kota` di antrean, daftar belum-lengkap/lolos, detail → lencana "Faskes baru".
- Uji: `scripts/qa/kso-komite/919_uji_faskes_baru.sql`, `apps/api/src/repo/kso-faskes-baru.test.ts`.
