"""normalisasi_waktu — F-CASHIN.

Regresi insiden 25 Sep 2026: OCR menyalin jam koran BNI apa adanya
('24/09/2026 18.25.14'), API meneruskannya ke kolom timestamptz, driver
Postgres melempar 'Invalid time value', dan statement BNI tertinggal
'terverifikasi' dengan nol baris mutasi.

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.koran import normalisasi_waktu  # noqa: E402

TGL = "2026-09-24"


class TestNormalisasiWaktu(unittest.TestCase):
    def test_format_cetak_bni_dari_ocr(self):
        self.assertEqual(normalisasi_waktu("24/09/2026 18.25.14", TGL), "2026-09-24 18:25:14")

    def test_iso_dibiarkan(self):
        self.assertEqual(normalisasi_waktu("2026-09-24 18:25:14", TGL), "2026-09-24 18:25:14")
        self.assertEqual(normalisasi_waktu("2026-09-24T08:05", TGL), "2026-09-24 08:05:00")

    def test_jam_saja_dilengkapi_tanggal_statement(self):
        self.assertEqual(normalisasi_waktu("18:25:14", TGL), "2026-09-24 18:25:14")
        self.assertEqual(normalisasi_waktu("8.05", TGL), "2026-09-24 08:05:00")

    def test_jam_saja_tanpa_tanggal_statement_dibuang(self):
        self.assertIsNone(normalisasi_waktu("18:25:14", None))

    def test_tanggal_saja(self):
        self.assertEqual(normalisasi_waktu("24-09-2026", TGL), "2026-09-24 00:00:00")

    def test_sampah_dibuang_bukan_dilempar(self):
        for raw in ("24 Sep 18:25", "kemarin", "", "25:00", "31/13/2026 10:00", None, 1790314200):
            self.assertIsNone(normalisasi_waktu(raw, TGL), raw)


if __name__ == "__main__":
    unittest.main()
