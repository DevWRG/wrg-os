"""Pembaca lampiran PDF "KSO CPRR" — app/kso_cprr.py + endpoint /kso/ocr-cprr.

Teks di bawah SINTETIS (repo publik — nama sales, faskes, kota, dan angka
FIKTIF, jangan tempel cetakan asli), tapi tata letak dan gangguannya meniru
keluaran Tesseract psm 4 pada cetakan asli Simulator KSO yang diuji 10 Nov
2026: celah lebar antar-kolom header, "└" terbaca "L", "5%" terbaca "596",
"QC" terbaca "OC", titik ribuan terbaca ":" / ";", "Rp 0" terbaca "Rp o",
awalan "|" / "{|" di judul seksi.

Dijalankan stdlib `unittest`, sama seperti test_klaim_ekstrak.py.
"""

import base64
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import kso_cprr  # noqa: E402
from app.kso_cprr import angka, ekstrak_cprr, pecah_header, periksa, persen  # noqa: E402

HEMATO_BERSIH = """10/02/26, 9:15 AM                                         KSO CPRR — H90 (3-Diff)

= LifeLine
KSO CPRR — HEMATOLOGI                                       forts os Aen
COST PER RESULT REPORT - KERJA SAMA OPERASIONAL                     Tanggal: 02/10/2026
NAMA SALES                        NAMA FASKES                       KOTA / KAB
BUDI SANTOSO                      RSU HARAPAN CONTOH                KAB. CONTOH RAYA

{| RINGKASAN KSO

Nama Analyzer                                                   H90 (3-Diff)
Total CAPEX                                                     Rp 48.000.000

L UPS                                                           Rp 8.000.000

L LIS                                                           Rp 40.000.000
Masa KSO                                                    24 bulan

Test / Bulan                                                            500 test

Total Target Test KSO                                              12.000 test

Hari Kerja / Bulan                                         22 hari

Margin / Markup                                              10%

QC & Kalibrator                                                    FREE — supplier

| CPRR — COST PER TEST

CAPEX / Test                                                                    Rp 4.000
Reagen / Test                                                                   Rp 5.250
QC + Kalibrasi / Test                                                           Rp 1.100
Base Cost / Test                                                                Rp 10.350
Markup 10%                                                                      Rp 1.035
CPRR (Harga Jual / Test)                                                        Rp 11.385

| RINCIAN REAGEN

NAMA BARANG                          KEMASAN                 KONTRIB / TEST         SELL / KIT KSO
CONTOH DILUENT 10L                   10.000 mL/jeriken       Rp 2.100          Rp 900.000
CONTOH PROBE CLEANSER 50ML           50 mL/btl                      Rp o            Rp 120.000

INFORMASI KOMPETITOR MEREK-X XN 300 - 13.000 (LIS gratis, QC sendiri)

Wahana Lifeline - KSO CPRR Hematologi - H90 (3-Diff)                 Dokumen ini bersifat konfidensial
"""

# Varian kotor: % → 96, QC → OC, titik ribuan → ":"/";", O di tengah angka,
# awalan "|" pada nilai, judul tanpa tanggal (header biru hilang di grayscale).
HEMATO_KOTOR = """KSO CPRR — HEMATOLOGI   wn nnn
NAMA SALES                        NAMA FASKES                       KOTA / KAB
DEWI                              KLINIK SEHAT CONTOH               SUKAMAJU

| RINGKASAN KSO
Nama Analyzer                                  | H90 (3-Diff)
Total CAPEX                                    | Rp 48:000.000
└ UPS                                                  Rp 8.000.000
Ltis                                                  Rp 40.000.000
Masa KSO                                       | 3O bulan
Test / Bulan                                         4O0 test
Total Target Test KSO                                12;000 test
Hari Kerja / Bulan                                   2O hari
Margin / Markup                                      796
OC & Kalibrator                                      PAID — mandiri
{| CPRR — COST PER TEST
CAPEX / Test                                                   Rp 4.0O0
Reagen / Test                                                  Rp 5:250
OC + Kalibrasi / Test                                          Rp 1,100
Base Cost / Test                                               Rp 10.350
Markup 796                                                     Rp 725
CPRR (Harga Jual / Test)                                       Rp 11:075
INFORMASI KOMPETITOR —
"""

KIMIA_KLINIK = """KSO CPRR — KIMIA KLINIK
COST PER RESULT REPORT - KERJA SAMA OPERASIONAL        Tanggal: 15/09/2026
NAMA SALES          NAMA FASKES          KOTA / KABUPATEN
ANDI                PUSKESMAS CONTOH     KOTA CONTOH
| RINGKASAN KSO
Nama analyzer                    K200
Total CAPEX                      Rp 150.000.000
Masa KSO                         60 bulan
Sampel / bulan                   1.000 sampel
Total target test KSO            60.000 test
Hari kerja / bulan               25 hari
Margin / markup                  15%
| CPRR — BEBAN TETAP & RATA-RATA
Cuvette                          Rp 300
Total consumable / test          Rp 450
+ CAPEX / test                   Rp 2.500
QC control / test                Rp 700
Kalibrasi / test                 Rp 300
CPRR rata-rata (harga jual / test)   Rp 9.800
INFORMASI KOMPETITOR —
"""

# Cetakan lama: grid 2 kolom — dua pasangan label-nilai sebaris.
GRID_DUA_KOLOM = """KSO CPRR — CLIA
NAMA SALES  NAMA FASKES  KOTA / KAB
RINA  RS CONTOH  KOTA BARU
Nama analyzer   C10    Total CAPEX   Rp 200.000.000
Masa KSO   48 bulan    Test / bulan   300 test
Total target test KSO   14.400 test    Hari kerja / bulan   24 hari
Margin / markup   20%    Parameter ditawarkan   12 parameter
CAPEX / test   Rp 13.889
Consumable / test   Rp 1.200
Rata-rata reagen / test   Rp 30.000
Base cost rata-rata / test   Rp 45.089
CPRR rata-rata (harga jual / test)   Rp 54.107
INFORMASI KOMPETITOR MEREK-Y 25.000
"""


class TestAngka(unittest.TestCase):
    def test_rupiah_titik_ribuan(self):
        self.assertEqual(angka("Rp 48.000.000"), 48000000)
        self.assertEqual(angka("Rp 11.385"), 11385)

    def test_separator_ocr(self):
        self.assertEqual(angka("12;000 test"), 12000)
        self.assertEqual(angka("Rp 48:000.000"), 48000000)
        self.assertEqual(angka("Rp 1,100"), 1100)

    def test_huruf_o_di_tengah_angka(self):
        self.assertEqual(angka("4O0 test"), 400)
        self.assertEqual(angka("Rp 4.0O0"), 4000)

    def test_huruf_o_tak_ambigu_dibiarkan(self):
        # "TOO" bisa "700" atau "100" — jangan ditebak.
        self.assertIsNone(angka("TOO test"))

    def test_rp_nol(self):
        self.assertEqual(angka("Rp o"), 0)
        self.assertEqual(angka("Rp0"), 0)

    def test_kosong(self):
        self.assertIsNone(angka("—"))
        self.assertIsNone(angka(None))

    def test_persen(self):
        self.assertEqual(persen("10%"), 10.0)
        self.assertEqual(persen("7,5 %"), 7.5)
        self.assertEqual(persen("596"), 5.0)  # "5%" terbaca "596"
        self.assertEqual(persen("1096"), 10.0)
        self.assertIsNone(persen("—"))


class TestHeader(unittest.TestCase):
    def test_celah_lebar_pasti(self):
        s, f, k, mentah, pasti = pecah_header(HEMATO_BERSIH)
        self.assertEqual((s, f, k), ("BUDI SANTOSO", "RSU HARAPAN CONTOH", "KAB. CONTOH RAYA"))
        self.assertTrue(pasti)
        self.assertEqual(mentah, "BUDI SANTOSO RSU HARAPAN CONTOH KAB. CONTOH RAYA")

    def test_satu_spasi_tebakan(self):
        teks = "NAMA SALES NAMA FASKES KOTA / KAB\nDEWI KLINIK SEHAT SUKAMAJU\n"
        s, f, k, mentah, pasti = pecah_header(teks)
        self.assertEqual((s, f, k), ("DEWI", "KLINIK SEHAT", "SUKAMAJU"))
        self.assertFalse(pasti)
        self.assertEqual(mentah, "DEWI KLINIK SEHAT SUKAMAJU")

    def test_kolom_kosong_ditaruh_menurut_posisi(self):
        teks = (
            "NAMA SALES                NAMA FASKES               KOTA / KAB\n"
            "DEWI                                                SUKAMAJU\n"
        )
        s, f, k, _, pasti = pecah_header(teks)
        self.assertEqual((s, f, k), ("DEWI", None, "SUKAMAJU"))
        self.assertFalse(pasti)

    def test_strip_tanda_kosong(self):
        teks = "NAMA SALES      NAMA FASKES      KOTA / KAB\nDEWI      RS CONTOH      —\n"
        self.assertEqual(pecah_header(teks)[:3], ("DEWI", "RS CONTOH", None))

    def test_tanpa_header(self):
        self.assertEqual(pecah_header("tidak ada apa-apa"), (None, None, None, None, False))


class TestEkstrakHemato(unittest.TestCase):
    def test_bersih_semua_field(self):
        d = ekstrak_cprr(HEMATO_BERSIH)
        self.assertEqual(d["judul"], "KSO CPRR — HEMATOLOGI")
        self.assertEqual(d["tanggal"], "02/10/2026")
        self.assertEqual(d["nama_sales"], "BUDI SANTOSO")
        self.assertEqual(d["nama_faskes"], "RSU HARAPAN CONTOH")
        self.assertEqual(d["kota"], "KAB. CONTOH RAYA")
        self.assertEqual(d["analyzer"], "H90 (3-Diff)")
        self.assertEqual(d["capex_total"], 48000000)
        self.assertEqual(d["masa_bulan"], 24)
        self.assertEqual(d["test_per_bulan"], 500)
        self.assertEqual(d["total_target_test"], 12000)
        self.assertEqual(d["hari_kerja"], 22)
        self.assertEqual(d["markup_persen"], 10.0)
        self.assertEqual(d["capex_per_test"], 4000)
        self.assertEqual(d["reagen_per_test"], 5250)
        self.assertEqual(d["qc_per_test"], 1100)
        self.assertEqual(d["base_cost_per_test"], 10350)
        self.assertEqual(d["cprr_per_test"], 11385)
        # Teks kompetitor utuh walau memuat kata yang mirip label (LIS, QC).
        self.assertEqual(d["kompetitor_teks"], "MEREK-X XN 300 - 13.000 (LIS gratis, QC sendiri)")
        self.assertEqual(periksa(d), [])

    def test_judul_browser_bukan_judul_dokumen(self):
        # Baris kepala browser "KSO CPRR — H90 (3-Diff)" tak boleh jadi judul.
        self.assertEqual(ekstrak_cprr(HEMATO_BERSIH)["judul"], "KSO CPRR — HEMATOLOGI")

    def test_kotor(self):
        d = ekstrak_cprr(HEMATO_KOTOR)
        self.assertEqual(d["judul"], "KSO CPRR — HEMATOLOGI")
        self.assertIsNone(d["tanggal"])
        self.assertEqual((d["nama_sales"], d["nama_faskes"], d["kota"]), ("DEWI", "KLINIK SEHAT CONTOH", "SUKAMAJU"))
        self.assertEqual(d["analyzer"], "H90 (3-Diff)")
        self.assertEqual(d["capex_total"], 48000000)
        self.assertEqual(d["masa_bulan"], 30)
        self.assertEqual(d["test_per_bulan"], 400)
        self.assertEqual(d["total_target_test"], 12000)
        self.assertEqual(d["hari_kerja"], 20)
        self.assertEqual(d["markup_persen"], 7.0)
        self.assertEqual(d["capex_per_test"], 4000)
        self.assertEqual(d["reagen_per_test"], 5250)
        self.assertEqual(d["qc_per_test"], 1100)
        self.assertEqual(d["base_cost_per_test"], 10350)
        self.assertEqual(d["cprr_per_test"], 11075)
        self.assertIsNone(d["kompetitor_teks"])

    def test_persen_tegas_didahulukan(self):
        teks = "KSO CPRR — HPLC\nMargin / Markup   596\nMarkup 5%   Rp 100\n"
        self.assertEqual(ekstrak_cprr(teks)["markup_persen"], 5.0)


class TestEkstrakKategoriLain(unittest.TestCase):
    def test_kimia_klinik(self):
        d = ekstrak_cprr(KIMIA_KLINIK)
        self.assertEqual(d["judul"], "KSO CPRR — KIMIA KLINIK")
        self.assertEqual(d["tanggal"], "15/09/2026")
        self.assertEqual((d["nama_sales"], d["nama_faskes"], d["kota"]), ("ANDI", "PUSKESMAS CONTOH", "KOTA CONTOH"))
        self.assertEqual(d["analyzer"], "K200")
        self.assertEqual(d["test_per_bulan"], 1000)  # "Sampel / bulan"
        self.assertEqual(d["total_target_test"], 60000)
        self.assertEqual(d["markup_persen"], 15.0)
        self.assertEqual(d["capex_per_test"], 2500)  # "+ CAPEX / test"
        self.assertEqual(d["qc_per_test"], 1000)  # QC control + kalibrasi dijumlah
        self.assertIsNone(d["reagen_per_test"])
        self.assertIsNone(d["base_cost_per_test"])
        self.assertEqual(d["cprr_per_test"], 9800)  # "CPRR rata-rata (...)"

    def test_grid_dua_kolom_clia(self):
        d = ekstrak_cprr(GRID_DUA_KOLOM)
        self.assertEqual(d["judul"], "KSO CPRR — CLIA")
        self.assertEqual(d["analyzer"], "C10")
        self.assertEqual(d["capex_total"], 200000000)
        self.assertEqual(d["masa_bulan"], 48)
        self.assertEqual(d["test_per_bulan"], 300)
        self.assertEqual(d["total_target_test"], 14400)
        self.assertEqual(d["hari_kerja"], 24)
        self.assertEqual(d["markup_persen"], 20.0)
        self.assertEqual(d["capex_per_test"], 13889)
        self.assertEqual(d["reagen_per_test"], 30000)  # "Rata-rata reagen / test"
        self.assertEqual(d["base_cost_per_test"], 45089)
        self.assertEqual(d["cprr_per_test"], 54107)
        self.assertEqual(d["kompetitor_teks"], "MEREK-Y 25.000")
        self.assertEqual(periksa(d), [])

    def test_running_cost_blood_gas(self):
        teks = "KSO RUNNING COST — BLOOD GAS\nHPP cartridge / test (kit penuh)   Rp 20.000\nRunning cost (harga jual / test)   Rp 30.000\n"
        d = ekstrak_cprr(teks)
        self.assertEqual(d["judul"], "KSO RUNNING COST — BLOOD GAS")
        self.assertEqual(d["reagen_per_test"], 20000)
        self.assertEqual(d["cprr_per_test"], 30000)


class TestPeriksa(unittest.TestCase):
    def test_angka_tak_konsisten_ditandai(self):
        d = ekstrak_cprr(HEMATO_BERSIH)
        d["capex_per_test"] = 7000  # salah baca 4.000
        d["total_target_test"] = 13000
        out = periksa(d)
        self.assertEqual(len(out), 2)


def _req(pdf: bytes, dry_run: bool = False):
    from app.schemas import KsoOcrCprrRequest

    return KsoOcrCprrRequest(pdf_base64=base64.b64encode(pdf).decode("ascii"), dry_run=dry_run)


class TestEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.main import kso_ocr_cprr

        cls.ep = staticmethod(kso_ocr_cprr)

    def test_tesseract_tak_ada(self):
        with mock.patch.object(kso_cprr, "tesseract_cmd", return_value=None):
            res = self.ep(_req(b"%PDF-1.4\n%%EOF\n"))
        self.assertFalse(res.ok)
        self.assertEqual(res.galat, "ocr-tidak-tersedia")
        self.assertIsNone(res.isian.cprr_per_test)

    def test_bukan_pdf(self):
        res = self.ep(_req(b"bukan pdf"))
        self.assertEqual(res.galat, "pdf-rusak")

    def test_base64_rusak(self):
        from app.schemas import KsoOcrCprrRequest

        res = self.ep(KsoOcrCprrRequest(pdf_base64="@@@"))
        self.assertEqual(res.galat, "pdf-rusak")

    def test_dry_run(self):
        res = self.ep(_req(b"%PDF-1.4", dry_run=True))
        self.assertEqual((res.ok, res.galat), (False, "dry-run"))

    def _jalan(self, teks_per_lintasan):
        teks = list(teks_per_lintasan)
        with mock.patch.object(kso_cprr, "tesseract_cmd", return_value="/bin/tesseract"), \
                mock.patch.object(kso_cprr, "jumlah_halaman", return_value=1), \
                mock.patch.object(kso_cprr, "render_pdfium", return_value=[b"png"]), \
                mock.patch.object(kso_cprr, "ocr_png", side_effect=lambda *a: teks.pop(0)) as ocr:
            res = self.ep(_req(b"%PDF-1.4"))
        return res, ocr

    def test_alur_penuh_satu_lintasan(self):
        res, ocr = self._jalan([HEMATO_BERSIH])
        self.assertTrue(res.ok)
        self.assertIsNone(res.galat)
        self.assertEqual(res.halaman, 1)
        self.assertEqual(res.isian.cprr_per_test, 11385)
        self.assertTrue(res.isian.header_pasti)
        self.assertEqual(ocr.call_count, 1)  # semua field terisi → tanpa lintasan kedua

    def test_lintasan_kedua_mengisi_yang_kosong(self):
        kedua = "Tanggal: 03/10/2026\nMasa KSO   99 bulan\n"
        res, ocr = self._jalan([HEMATO_KOTOR, kedua])
        self.assertEqual(ocr.call_count, 2)
        self.assertEqual(res.isian.tanggal, "03/10/2026")
        self.assertEqual(res.isian.masa_bulan, 30)  # nilai lintasan pertama tidak ditimpa

    def test_bukan_cprr(self):
        res, _ = self._jalan(["SURAT JALAN\nNo. 123\n"])
        self.assertFalse(res.ok)
        self.assertEqual(res.galat, "bukan-cprr")

    def test_cprr_tak_terbaca(self):
        res, _ = self._jalan(["KSO CPRR — HPLC\nCAPEX / test  Rp 1.000\n", ""])
        self.assertFalse(res.ok)
        self.assertEqual(res.galat, "cprr-tidak-terbaca")
        self.assertEqual(res.isian.capex_per_test, 1000)


if __name__ == "__main__":
    unittest.main()
