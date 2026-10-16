"""F170 #KSO — penyaring hasil LLM (app/kso_intake.py).

Prinsip yang diuji: penyaring hanya MEMBUANG, tak pernah menambah. Kolom yang tidak bisa
dilacak ke ucapan AM gugur jadi null, supaya bot bertanya alih-alih menyimpan tebakan.
Teks SINTETIS (repo publik). Dijalankan stdlib `unittest`, sama seperti test_klaim_ekstrak.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.kso_intake import angka_dalam_teks, bersihkan, parse_json_llm  # noqa: E402

CONTOH_A = """#KSO
Faskes: RS Swasta A, Surabaya, tipe B
Alat: 1 unit Z3 hematologi
Volume: 900 test/bulan
Sumber: data LIS 3 bulan terakhir, dikirim kepala lab
Pendukung: dr. Rina SpPK, kepala instalasi lab, ketemu 10 Okt 2026
Kompetitor: Sysmex XN-550, kontrak habis Maret 2027
Diminta: tenor 36 bulan, tanpa klausul khusus
Risiko: pengadaan minta harga di bawah daftar"""

LLM_A = {
    "faskes_teks": "RS Swasta A, Surabaya", "alat_teks": "Z3 hematologi", "jumlah": 1,
    "volume_estimasi": 900, "volume_sumber": "data LIS 3 bulan terakhir, dikirim kepala lab",
    "harga_per_test": None, "tenor_bulan": 36, "unit_status": None, "klausul_khusus": [],
    "pendukung": [{"nama": "dr. Rina SpPK", "tipe": "kepala_instalasi", "tanggal": "2026-10-10", "cara": None}],
    "kompetitor_alat": "Sysmex XN-550", "kompetitor_kontrak_habis": "2027-03",
    "risiko_catatan": "pengadaan minta harga di bawah daftar", "lead_asal": None,
}


class AngkaTest(unittest.TestCase):
    def test_varian_ucapan(self):
        a = angka_dalam_teks("harga 18,5 rb, capex 53,4 jt, tenor 3 tahun, volume 800-1000, 18.500")
        for v in (18500, 53_400_000, 36, 800, 1000):
            self.assertIn(v, a)


class BersihkanTest(unittest.TestCase):
    def test_contoh_a_lolos_utuh(self):
        h = bersihkan(LLM_A, CONTOH_A)
        self.assertEqual(h["volume_estimasi"], 900)
        self.assertEqual(h["tenor_bulan"], 36)
        self.assertEqual(h["klausul_khusus"], [])
        self.assertEqual(h["volume_sumber"], LLM_A["volume_sumber"])
        self.assertEqual(h["pendukung"][0]["tipe"], "kepala_instalasi")
        self.assertEqual(h["kompetitor_kontrak_habis"], "2027-03-01")

    def test_tenor_tak_diucapkan_dibuang(self):
        teks = CONTOH_A.replace("tenor 36 bulan, ", "")
        h = bersihkan(dict(LLM_A, tenor_bulan=36), teks)  # model mengisi 36 sendiri
        self.assertIsNone(h["tenor_bulan"])

    def test_tenor_dalam_tahun(self):
        h = bersihkan({"tenor_bulan": 36}, "minta tenor 3 tahun")
        self.assertEqual(h["tenor_bulan"], 36)

    def test_unit_status_tanpa_kata_dibuang(self):
        h = bersihkan(dict(LLM_A, unit_status="baru"), CONTOH_A)
        self.assertIsNone(h["unit_status"])
        h = bersihkan({"unit_status": "baru"}, "unit baru dari principal")
        self.assertEqual(h["unit_status"], "baru")

    def test_klausul_tak_disinggung_jadi_null(self):
        h = bersihkan({"klausul_khusus": []}, "Faskes RS X, alat Z3, volume 500 dari data LIS")
        self.assertIsNone(h["klausul_khusus"])

    def test_klausul_kode_asing_dibuang(self):
        h = bersihkan({"klausul_khusus": ["eksklusivitas", "gratis_servis"]}, "RS minta eksklusivitas")
        self.assertEqual(h["klausul_khusus"], ["eksklusivitas"])

    def test_pendukung_karangan_dibuang(self):
        h = bersihkan({"pendukung": [{"nama": "dr. Budi", "tipe": "dokter_user"}]}, CONTOH_A)
        self.assertEqual(h["pendukung"], [])

    def test_sumber_volume_diparafrasekan_dibuang(self):
        h = bersihkan(dict(LLM_A, volume_sumber="komunikasi lisan dengan pengadaan"), CONTOH_A)
        self.assertIsNone(h["volume_sumber"])

    def test_harga_ribuan(self):
        h = bersihkan({"harga_per_test": 18500}, "harga 18,5 rb per test")
        self.assertEqual(h["harga_per_test"], 18500)

    def test_enum_dan_tipe_asing(self):
        h = bersihkan({"pendukung": [{"nama": "Bu Sari", "tipe": "kepala_ruang"}], "lead_asal": "teman"}, "Bu Sari kepala ruang")
        self.assertIsNone(h["pendukung"][0]["tipe"])
        self.assertIsNone(h["lead_asal"])

    def test_jabatan_bukan_orang_kedua(self):
        # uji dev 16 Okt: model memecah satu baris jadi dua orang & memberi tipe dari gelar
        llm = [{"nama": "dr. Rina SpPK", "tipe": "dokter_user"}, {"nama": "kepala instalasi lab", "tipe": "kepala_instalasi"}]
        h = bersihkan({"pendukung": llm}, "Pendukung: dr. Rina SpPK, kepala instalasi lab, ketemu 10 Okt")
        self.assertEqual(h["pendukung"], [{"nama": "dr. Rina SpPK", "tipe": "kepala_instalasi", "tanggal": None, "cara": None}])

    def test_peran_per_baris(self):
        teks = "Pendukung:\n- dr. Rina SpPK, kepala instalasi lab\n- Bu Sari, analis lab\n- Pak Budi, pengadaan, telepon 12 Okt"
        llm = [{"nama": "dr. Rina SpPK"}, {"nama": "Bu Sari"}, {"nama": "Pak Budi"}]
        tipe = [p["tipe"] for p in bersihkan({"pendukung": llm}, teks)["pendukung"]]
        self.assertEqual(tipe, ["kepala_instalasi", "analis_perawat", "pengadaan"])

    def test_dokter_tanpa_jabatan_tetap_dokter_user(self):
        h = bersihkan({"pendukung": [{"nama": "dr. Andi", "tipe": None}]}, "pendukung dr. Andi, dokter SpPD pengguna utama")
        self.assertEqual(h["pendukung"][0]["tipe"], "dokter_user")

    def test_input_rusak(self):
        self.assertIsNone(bersihkan(None, "x")["faskes_teks"])  # type: ignore[arg-type]
        self.assertIsNone(parse_json_llm("bukan json"))
        self.assertEqual(parse_json_llm('```json\n{"a": 1}\n```'), {"a": 1})


if __name__ == "__main__":
    unittest.main()
