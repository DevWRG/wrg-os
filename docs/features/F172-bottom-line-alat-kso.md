# F172 — Bottom Line Alat KSO

Tab **Bottom Line Alat** di menu Komite KSO (`/kso-komite`). Batas harga minimum per tes untuk tiap
model alat KSO: Direktur menetapkan, Komite memakainya sebagai pegangan saat bilang ya atau tidak.
Asal: artifact Direktur "Bottom Line Alat KSO" (snapshot 21 Okt 2026); keputusan user 26 Okt — jadi
tab di Komite KSO, Direktur mengisi lewat UI WRG-OS.

## Rumus

```
lantai/tes = biaya reagen per tes + biaya tetap per bulan ÷ volume + (K × HPP) ÷ bulan ÷ volume
```

Default K = 3, bulan = 36, penyangga AM = 20% (diubah Direktur di layar, satu baris global).
Posisi realisasi: **Aman** ≥ lantai + penyangga · **Tipis** ≥ lantai · **Di bawah lantai** < lantai.

## Sumber data (migrasi 256)

| Angka | Sumber |
|---|---|
| Unit, faskes, skema | `kso_asset` aktif + in_populasi; jenis = `kso_jenis_kanonik(type_alat)`, model = `nama_alat` |
| Idle | unit di faskes dengan omzet 12 bln = 0. Unit tanpa faskes terpetakan dihitung terpisah (bukan idle) |
| Omzet / unit / bln | `kso_revenue_jenis_v` 12 bulan penuh terakhir, kategori `kso_kategori_skema`; omzet faskes × jenis **dibagi rata** ke unit sejenis di faskes itu; dibagi bulan aktif (penempatan terbuka) |
| Volume historis | median omzet/unit/bln (unit yang jalan) ÷ Rp/tes jenis |
| Rp/tes jenis | `kso_jenis_ringkas_v`, kecuali diisi manual di Acuan per jenis (Hemodialisa = tarif per tindakan) |
| HPP | aset tetap ALAT KSO yang SN unitnya tertulis di deskripsi/catatan aset; perolehan terbaru, median bila terbaru menyimpang > 40% |
| Biaya reagen | `kso_bottomline_biaya` per model; kalau kosong → taksiran Rp/tes × (1 − margin kotor jenis) |

Beda sengaja dengan artifact: artifact menempelkan omzet faskes utuh ke tiap unit (faskes dengan dua
alat sejenis terhitung dua kali) dan menambah unit dari aset tetap — angka WRG-OS bisa lebih rendah.

## Tabel

- `kso_bottomline_parameter` — K, bulan, penyangga (satu baris).
- `kso_bottomline_jenis` — kelompok layar, satuan (tes/tindakan), Rp/tes pengganti, margin kotor.
- `kso_bottomline_biaya` — biaya reagen per tes + biaya tetap per bulan per model.
- `kso_bottomline_keputusan` — HPP/volume/K pengganti, bottom line final, keputusan, catatan.
- `kso_bottomline_log` — riwayat setiap simpan (append-only).

## Izin

Fitur `kso-komite-bottomline` di Akses Grup: **lihat** = Komite, **ubah** = Direktur. Gate lama sebelum
fitur diatur: role direktur. Role admin TIDAK otomatis lolos (data HPP & biaya; role admin juga HOD).
Setelah rilis: Sync Fitur → centang grup Direktur (lihat+ubah) dan Komite (lihat).

## Impor biaya dari artifact

Angka biaya tidak di repo (repo publik). Simpan HTML artifact di Mac mini, lalu:

```
node scripts/ops/impor-bottomline-biaya.mjs --artifact ~/bottomline.html > /tmp/bl.sql
/opt/homebrew/bin/psql -d wrg_os_prod -v ON_ERROR_STOP=1 -f /tmp/bl.sql
```

Mengisi biaya 13 model bersumber nyata (Simulator, harga beli, BMHP HD), margin kotor 16 jenis, dan tarif
HD. Isian yang sudah diubah lewat layar tidak ditimpa. Aman dijalankan ulang.

## Belum (fase berikut)

- Menyambungkan lantai per model ke gerbang 2 & mandat F170 (sekarang masih `kso.kategori.harga_standar_per_test`) —
  butuh peta `kso.alat` ↔ model.
- Model yang hanya ada di aset tetap (belum masuk populasi KSO) tidak tampil.
