"""F85 Senin Brief — prompt & pembersih narasi.

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.senin import bersihkan_narasi, build_senin_system, build_senin_user  # noqa: E402

HOD = {
    "hod_key": "rocky", "nama": "Rocky", "peran": "Sales East", "status": "PERLU KLARIFIKASI",
    "watch_status": "YELLOW",
    "checks": [
        {"no": 2, "label": "Pipeline ber-Rp", "hasil": "FAIL", "detail": "120/271 deal lengkap (44%)"},
        {"no": 3, "label": "Tindak lanjut", "hasil": "NA", "detail": "belum ada sumber"},
    ],
    "metrics": [{"label": "Revenue", "actual": "Rp 410 jt", "target": "Rp 577 jt", "status": "YELLOW", "trend": "declining"}],
}


class TestSenin(unittest.TestCase):
    def test_pembuka_liar_dibuang(self):
        teks = "# Brief W41\nBerikut analisanya:\n\n## Gap Utama per HoD\n**Rocky** — x\n## Urutan Prioritas Bahasan\n1. Rocky"
        hasil = bersihkan_narasi(teks)
        self.assertTrue(hasil.startswith("## Gap Utama per HoD"))
        self.assertNotIn("# Brief W41", hasil)

    def test_tanpa_bagian_dikosongkan(self):
        # Model yang tak mengikuti format → kosong, supaya apps/api menandai narasi gagal.
        self.assertEqual(bersihkan_narasi("Maaf, saya tidak bisa."), "")
        self.assertEqual(bersihkan_narasi(""), "")

    def test_user_memuat_status_cek_dan_angka(self):
        u = build_senin_user([HOD])
        self.assertIn("STATUS: PERLU KLARIFIKASI", u)
        self.assertIn("Cek 2 Pipeline ber-Rp: FAIL — 120/271 deal lengkap (44%)", u)
        self.assertIn("Revenue: aktual Rp 410 jt / target Rp 577 jt", u)

    def test_system_mengunci_status_dan_health(self):
        s = build_senin_system("W41", "6–12 Oktober 2026", "RISK")
        self.assertIn("Overall Health sudah ditetapkan: RISK", s)
        self.assertIn("JANGAN diubah", s)
        for bagian in ("## Gap Utama per HoD", "## Pertanyaan Kritis Direktur", "## Keputusan Direktur Minggu Ini"):
            self.assertIn(bagian, s)


if __name__ == "__main__":
    unittest.main()
