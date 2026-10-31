# F172 — Bottom Line Alat KSO

Tab **Bottom Line Alat** di menu Komite KSO (`/kso-komite`). Asal: artifact Direktur "Bottom Line Alat
KSO" (21 Okt 2026, migrasi 256). Model hitung diganti mengikuti **Pedoman Komite KSO Forum v01**
(27 Okt 2026, migrasi 263): satu ukuran untuk semua alat — **GPM deal**.

## Rumus

```
GPM = 1 − (reagen/tes + (reagen tetap + QC per bulan)/volume + HPP/(tenor × volume)) ÷ harga/tes
```

Tenor default 36 bulan. Zona kewenangan (diubah Direktur di layar):

| GPM deal | Yang memutus |
|---|---|
| ≥ 55% | AM sendiri |
| 50–55% | Dua HOD (Bisnis + Area) |
| 45–50% | Forum → Direktur |
| < 45% | Hanya Direktur |

Tiga angka turunan untuk forum:
- **Volume minimum** — di harga acuan, berapa tes/bulan agar GPM ≥ batas zona ("tak tercapai" bila reagen saja sudah melebihi margin).
- **Harga minimum** — di volume acuan, harga terendah per zona. Harga minimum @45% = **bottom standar**.
- **HPP alat maksimal** — di harga & volume ini, harga alat tertinggi yang masih ≥ 45% (bahan negosiasi ke prinsipal).

Harga acuan = harga pasar terendah (isian Finance); bila kosong, realisasi Rp/tes OS. Volume acuan =
volume historis, atau isian Direktur di keputusan. **Peta GPM** = grid volume × harga berwarna per zona.
**Hemodialisa tidak memakai zona** (Kalkulator Investasi KSO HD, selalu Direktur).

## Bottom standar vs real bottom

| | Bottom standar | Real bottom |
|---|---|---|
| HPP | HPP standar Finance, atau aset tetap cocok SN | promo beli X gratis Y → HPP × X/(X+Y); alat didukung prinsipal → 0 |
| QC | penuh | 0 bila prinsipal memberi QC gratis |
| Dilihat | AM, HOD, Forum, Finance | **Direktur saja** |

Dukungan prinsipal dicatat bertanggal (`kso_bottomline_dukungan`) dan dibaca lewat endpoint terpisah
`GET /kso-komite/bottom-line/real` — tidak pernah ikut respons halaman biasa, WA, atau risalah.

## Sumber data

| Angka | Sumber |
|---|---|
| Unit, faskes, skema | `kso_asset` aktif + in_populasi; jenis = `kso_jenis_kanonik(type_alat)`, model = `nama_alat` |
| Idle | unit di faskes dengan omzet 12 bln = 0. Unit tanpa faskes dihitung terpisah (bukan idle) |
| Omzet / unit / bln | `kso_revenue_jenis_v` 12 bulan penuh terakhir, kategori `kso_kategori_skema`; omzet faskes × jenis **dibagi rata** ke unit sejenis; dibagi bulan aktif |
| Volume historis | median omzet/unit/bln (unit yang jalan) ÷ Rp/tes jenis |
| Rp/tes jenis | `kso_jenis_ringkas_v`, kecuali diisi manual di Acuan per jenis (HD = tarif per tindakan) |
| HPP | HPP standar Finance; bila kosong, aset tetap ALAT KSO yang SN unitnya tertulis di deskripsi/catatan (perolehan terbaru, median bila menyimpang > 40%) |
| Reagen, reagen tetap, QC, harga pasar | `kso_bottomline_biaya` (isian Finance / impor); reagen kosong → taksiran Rp/tes × (1 − margin kotor jenis) |

## Izin (Akses Grup)

| Fitur | Lihat | Ubah |
|---|---|---|
| `kso-komite-bottomline` | Forum, HOD, Finance | Direktur — keputusan & parameter zona |
| `kso-komite-bottomline-angka` | — | **Finance** — HPP standar, biaya reagen, QC, harga pasar, acuan jenis |
| `kso-komite-bottomline-real` | **Direktur** — angka real bottom | Direktur / Finance — catat dukungan prinsipal |

Gate lama sebelum fitur diatur: role direktur. Role admin TIDAK otomatis lolos. Setelah rilis: Sync Fitur →
centang ketiganya (Sync membuat baris mati untuk semua grup — sebelum dicentang, Direktur pun tertutup).

## Impor biaya dari artifact

Angka biaya tidak di repo (repo publik). Simpan HTML artifact di Mac mini, lalu:

```
node scripts/ops/impor-bottomline-biaya.mjs --artifact ~/bottomline.html > /tmp/bl.sql
/opt/homebrew/bin/psql -d wrg_os_prod -v ON_ERROR_STOP=1 -f /tmp/bl.sql
```

Mengisi reagen/reagen tetap/QC (terpisah) untuk model bersumber nyata, margin kotor per jenis, dan tarif HD.
HPP standar & harga pasar TIDAK diimpor (isian Finance). Isian lewat layar tidak ditimpa. Aman diulang.

## Belum (fase berikut Pedoman)

- Fase B (6 Nov): kolom harga beli reagen di Simulator KSO — biaya per parameter dari PO, bukan harga LIST.
- Fase C (13 Nov): F170 v2 — bot WA 7 isian membalas GPM + zona, antrean per zona, 7 gerbang v2, mandat tiga harga (55/50/45) berlaku 30 hari.
- Fase D (26 Nov): GPM per customer + tinjauan portofolio (idle > 60 hari, GPM < 45% tiga bulan).
- Model yang hanya ada di aset tetap (belum masuk populasi KSO) tidak tampil.
