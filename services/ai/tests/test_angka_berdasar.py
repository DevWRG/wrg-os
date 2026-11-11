"""Pemeriksa angka tak berdasar — app/angka_berdasar.py. Data SINTETIS (repo publik).

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.angka_berdasar import PENANDA, angka_tak_berdasar, ganti_angka_tak_berdasar, sebutan_angka  # noqa: E402

SUMBER = (
    "Revenue/bln: Rp 612 jt (target Rp 500 jt, hijau, membaik, +22% vs minggu sebelumnya)\n"
    "AR overdue >90 hari: Rp 1,2 M (target Rp 400 jt). Fill rate 77,5%.\n"
    "Rekap: cicilan RS Contoh Rp 3juta, tenggat 28/8. 14 customer belum order."
)


class TestAngkaBerdasar(unittest.TestCase):
    def test_angka_bersumber_lolos(self):
        nar = "Revenue Rp 612 jt (+22%), AR Rp 1,2 M melampaui Rp 400 jt; fill rate 77,5%; 14 customer; cicilan Rp 3 juta."
        self.assertEqual(angka_tak_berdasar(nar, SUMBER), [])

    def test_anggaran_karangan_tertangkap(self):
        nar = "Alokasikan insentif Rp 25j dan budget Rp 50-100jt; target reaktivasi 20% (37 customer)."
        t = angka_tak_berdasar(nar, SUMBER)
        self.assertIn("Rp 25j", t)
        self.assertTrue(any("50-100jt" in x for x in t))
        self.assertIn("20%", t)
        self.assertIn("37 customer", t)

    def test_pembulatan_dari_angka_mentah_diterima(self):
        self.assertEqual(angka_tak_berdasar("AR Rp 968 jt", "outstanding 968.123.273"), [])

    def test_ganti_menjaga_struktur_tabel(self):
        baris = "| 1 | Win-back | APPROVE - insentif Rp 25j |"
        hasil, diganti = ganti_angka_tak_berdasar(baris, SUMBER)
        self.assertEqual(diganti, ["Rp 25j"])
        self.assertEqual(hasil, f"| 1 | Win-back | APPROVE - insentif {PENANDA} |")

    def test_nomor_daftar_dan_tanggal_tak_diperiksa(self):
        self.assertEqual(sebutan_angka("1. Agenda 28/8 pukul 08:00 minggu W35"), [])


if __name__ == "__main__":
    unittest.main()
