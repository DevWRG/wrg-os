"""F85 Senin Brief — prompt & pembersih narasi.

Dijalankan stdlib `unittest`, sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.senin import (  # noqa: E402
    bersihkan_narasi, buang_kalimat_pelanggar, build_senin_system, build_senin_user, cek_pelanggaran,
)

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

    def test_garis_pemisah_dibuang(self):
        teks = "## Gap Utama per HoD\n- a\n\n---\n\n## Urutan Prioritas Bahasan\n1. x\n***\n"
        hasil = bersihkan_narasi(teks)
        self.assertNotIn("---", hasil)
        self.assertNotIn("***", hasil)
        self.assertIn("## Urutan Prioritas Bahasan", hasil)

    def test_system_melarang_sanksi_dan_menimbang_dampak(self):
        s = build_senin_system("W40", "28 September – 4 Oktober 2026", "RISK", "W41")
        self.assertIn("DILARANG mengusulkan sanksi", s)
        self.assertIn("bonus, insentif, atau kompensasi", s)
        self.assertIn("DAMPAK BISNIS", s)

    def test_tenggat_berjangkar_minggu_rapat(self):
        s = build_senin_system("W40", "28 September – 4 Oktober 2026", "RISK", "W41")
        self.assertIn("Minggu W40 sudah lewat", s)
        self.assertIn("'Rabu W41'", s)

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

    def test_system_aturan_w41(self):
        s = build_senin_system("W41", "5–11 Oktober 2026", "RED", "W42")
        self.assertIn("ancaman bersyarat", s)
        self.assertIn("Sales Manager", s)  # disebut sebagai contoh yang DILARANG
        self.assertIn("Jangan memindahkan angka satu HoD ke HoD lain", s)
        self.assertIn("'setiap Jumat'", s)

    def test_pelanggaran_brief_w41_tertangkap(self):
        # Tiga kalimat yang benar-benar muncul di brief prod 12 Okt 2026.
        teks = (
            "**3. Mufid, Arman: serahkan data terkini (Rabu W42), atau HoD tidak hadir rapat W43.**\n"
            "Siapa: Rocky & Yogi via Sales Manager. Tenggat: Selasa W42 pagi.\n"
            "**1. Rocky & Yogi wajib submit daily deal close list (nominal) setiap Jumat W42.**"
        )
        jenis = [x.split(":")[0] for x in cek_pelanggaran(teks)]
        self.assertEqual(jenis, ["ancaman bersyarat", "jabatan karangan", "frekuensi kontradiktif"])

    def test_koordinator_karangan_tertangkap(self):
        # Muncul di uji ulang Haiku prod 12 Okt (input W41).
        teks = (
            "**1. Intensif Clearance AR Overdue & Fill Rate Recovery — Ika Koordinator**\n"
            "Direktur review untuk eskalasi ke Direktur & BD Koordinator fokus akun strategis.\n"
            "Supervisor gudang cek ulang stok."
        )
        # Temuan unik per teks: "Koordinator" dua kali = satu temuan.
        self.assertEqual(cek_pelanggaran(teks), ["jabatan karangan: “Koordinator”", "jabatan karangan: “Supervisor”"])
        self.assertEqual(cek_pelanggaran("Husni koordinasi dengan tim; Ika mengoordinasikan penagihan."), [])

    def test_kalimat_sah_tidak_tertangkap(self):
        sah = (
            "6/6 AM submit plan · report 95/156 plan (61%)\n"
            "Ika presentasi AR overdue top 10 customer + jadwal bayar 14 hari, tenggat Senin W42.\n"
            "Analisis churn per akun (alasan, nilai, PIC hubungi ulang) dari Rocky & Yogi, Selasa W42.\n"
            "Laporan harian deal close tiap hari kerja W42; rekap mingguan Jumat."
        )
        self.assertEqual(cek_pelanggaran(sah), [])

    def test_buang_kalimat_pelanggar_jaga_struktur(self):
        teks = (
            "## Keputusan Direktur Minggu Ini\n\n"
            "**1. Lengkapi data metric manual Rabu W42, atau tidak boleh hadir rapat.**\n"
            "Lima HoD 0 metric terisi. Siapa: Mufid via Sales Manager. Tenggat: Rabu W42."
        )
        b = buang_kalimat_pelanggar(teks)
        self.assertIn("## Keputusan Direktur Minggu Ini", b)
        self.assertNotIn("**1.", b)  # judul tinggal penanda → dibuang utuh
        self.assertIn("Lima HoD 0 metric terisi. Tenggat: Rabu W42.", b)
        self.assertEqual(cek_pelanggaran(b), [])


if __name__ == "__main__":
    unittest.main()
