"""Ekstraksi field nota #KLAIM dari teks Tesseract — app/klaim.py.

Teks di bawah SINTETIS (repo publik — jangan tempel isi nota asli), tapi
meniru gangguan nyata Tesseract pada struk thermal yang ditemukan saat uji
15 Okt 2026: huruf pertama "Total" hilang/terbaca '[', angka 7 terbaca 1,
tahun 2026 terbaca 2006, baris sampah di antara baris berisi.

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.klaim import cari_nominal, cari_nomor, cari_pihak, cari_tanggal, ekstrak_klaim  # noqa: E402

STRUK_MINIMARKET = """Ctri
—         SMS/WA: 081100000000
e           ALFAMART CONTOH RAYA / 081100000001 ie
=    =       a JL. CONTOH NO. 1, SURABAYA    ~
Sees AP : 01.000.000.0-000.000
SEL fon 1049-123-0700HN9 Kasir BUDI
Meme AIO Ice cPcigOZ 1 15000 15,000. Ea
SE total Iter I         io aan
SS ee Jotal Disc.             5,000 $    :
es [otal Belanja           10,000
Tunai                       20,000
Kembali                     10,000
SSS Igl, 01-08-2006 19:08:42 V,2008.5.2
"""

INVOICE_TOKO = """CV SUMBER MAKMUR ABADI
Jl. Raya Contoh 12 Sidoarjo
Telp. 031-0000000
No. Nota: INV-2026/0012
Tanggal: 14 Okt 2026
Kertas A4 2 rim          120.000
Tinta printer             85.000
Grand Total            Rp 205.000
"""


class TestNominal(unittest.TestCase):
    def test_total_belanja_meski_huruf_t_hilang(self):
        self.assertEqual(cari_nominal(STRUK_MINIMARKET), "10,000")

    def test_bukan_tunai_kembali_atau_diskon(self):
        # Angka terbesar (20,000) = uang tunai, bukan total.
        self.assertNotEqual(cari_nominal(STRUK_MINIMARKET), "20,000")

    def test_grand_total_invoice(self):
        self.assertEqual(cari_nominal(INVOICE_TOKO), "205.000")

    def test_label_dan_angka_beda_baris(self):
        self.assertEqual(cari_nominal("TOTAL BAYAR\n150.000\n"), "150.000")

    def test_tanpa_label_total_kosong(self):
        self.assertIsNone(cari_nominal("1 15,000 15,000\n10,000\n20,000\n"))


class TestTanggal(unittest.TestCase):
    def test_tahun_salah_baca_dikosongkan(self):
        self.assertIsNone(cari_tanggal(STRUK_MINIMARKET, tahun_sekarang=2026))

    def test_tanggal_kata_bulan(self):
        self.assertEqual(cari_tanggal(INVOICE_TOKO, tahun_sekarang=2026), "14 Okt 2026")

    def test_tanggal_angka_dan_tahun_lalu(self):
        self.assertEqual(cari_tanggal("Tgl 28/12/2025 10:00", tahun_sekarang=2026), "28/12/2025")
        self.assertEqual(cari_tanggal("07-08-26 19:08", tahun_sekarang=2026), "07-08-26")

    def test_npwp_telepon_bukan_tanggal(self):
        self.assertIsNone(cari_tanggal("NPWP 01.336.238.9\nTelp 031-0000000", tahun_sekarang=2026))


class TestNomorDanPihak(unittest.TestCase):
    def test_nomor_berlabel(self):
        self.assertEqual(cari_nomor(INVOICE_TOKO), "INV-2026/0012")

    def test_nomor_tak_berlabel_kosong(self):
        self.assertIsNone(cari_nomor(STRUK_MINIMARKET))

    def test_label_di_tengah_kata_diabaikan(self):
        self.assertIsNone(cari_nomor("PREFERENSI 12345"))

    def test_merek_dikenal(self):
        self.assertEqual(cari_pihak(STRUK_MINIMARKET), "ALFAMART CONTOH RAYA")

    def test_nama_toko_baris_awal(self):
        self.assertEqual(cari_pihak(INVOICE_TOKO), "CV SUMBER MAKMUR ABADI")


class TestEkstrak(unittest.TestCase):
    def test_gabungan_mode_dan_raw_text(self):
        f = ekstrak_klaim(["teks psm 6 tanpa total", "Total Bayar 50.000"])
        self.assertEqual(f["nominal"], "50.000")
        self.assertEqual(f["raw_text"], "teks psm 6 tanpa total")


if __name__ == "__main__":
    unittest.main()
