"""Aduan GA — prompt & validasi keluaran LLM pemilah grup WA.

Dijalankan stdlib `unittest`, sama seperti test_senin.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.aduan_ga import build_aduan_system, build_aduan_user, parse_aduan  # noqa: E402

KAT = ["UMUM", "IT", "PERMINTAAN"]


class TestPrompt(unittest.TestCase):
    def test_system_menyebut_kategori(self):
        s = build_aduan_system(KAT)
        self.assertIn("UMUM, IT, PERMINTAAN", s)
        self.assertIn("aduan_baru", s)

    def test_user_menandai_staf_ga_dan_tiket(self):
        u = build_aduan_user(
            [{"ref": "M1", "waktu": "16/11 08:55", "pengirim": "Staf", "staf_ga": True, "isi": "ya mbak\nnanti"}],
            [{"ref": "K1", "waktu": "16/11 08:54", "pengirim": "Pelapor", "staf_ga": False, "isi": "lampu mati"}],
            [{"no": "TKT-2026-00001", "status": "open", "dibuka": "06/11", "pelapor": "A", "judul": "AC bocor"}],
        )
        self.assertIn("M1 | 16/11 08:55 | [GA] Staf: ya mbak nanti", u)
        self.assertIn("[PELAPOR] Pelapor: lampu mati", u)
        self.assertIn("TKT-2026-00001 | open", u)
        self.assertLess(u.index("TIKET TERBUKA"), u.index("PESAN BARU"))

    def test_user_tanpa_tiket(self):
        u = build_aduan_user([{"ref": "M1", "isi": "x"}], [], [])
        self.assertIn("TIKET TERBUKA: (tidak ada)", u)
        self.assertNotIn("PESAN KONTEKS", u)


class TestParse(unittest.TestCase):
    def test_json_rusak_none(self):
        self.assertIsNone(parse_aduan("bukan json", ["M1"], KAT))
        self.assertIsNone(parse_aduan('{"aksi": "x"}', ["M1"], KAT))

    def test_pagar_markdown_dan_normalisasi(self):
        text = """```json
{"aksi": [
 {"ref": "M1", "jenis": "ADUAN_BARU", "judul": "Lampu  mati di atas meja", "kategori": "umum",
  "lokasi": null, "prioritas": "HIGH", "yakin": 0.9},
 {"ref": "M2", "jenis": "progres", "tiket": "M1", "yakin": 1.7},
 {"ref": "M9", "jenis": "selesai", "tiket": "TKT-2026-00001"},
 {"ref": "M2", "jenis": "selesai", "tiket": "M1"},
 {"ref": "M3", "jenis": "ngawur"}
]}
```"""
        r = parse_aduan(text, ["M1", "M2", "M3"], KAT)
        self.assertEqual([a["ref"] for a in r], ["M1", "M2"])  # M9 tak dikenal, M2 kedua dobel, M3 jenis salah
        self.assertEqual(r[0]["jenis"], "aduan_baru")
        self.assertEqual(r[0]["judul"], "Lampu mati di atas meja")
        self.assertEqual(r[0]["kategori"], "UMUM")
        self.assertEqual(r[0]["prioritas"], "high")
        self.assertEqual(r[1]["tiket"], "M1")
        self.assertEqual(r[1]["yakin"], 1.0)

    def test_kategori_asing_dibuang(self):
        r = parse_aduan('{"aksi":[{"ref":"M1","jenis":"aduan_baru","kategori":"LISTRIK","prioritas":"urgent"}]}', ["M1"], KAT)
        self.assertIsNone(r[0]["kategori"])
        self.assertIsNone(r[0]["prioritas"])
        self.assertEqual(r[0]["yakin"], 0.0)

    def test_array_polos_diterima(self):
        r = parse_aduan('[{"ref":"M1","jenis":"abaikan"}]', ["M1"], KAT)
        self.assertEqual(r[0]["jenis"], "abaikan")


if __name__ == "__main__":
    unittest.main()
