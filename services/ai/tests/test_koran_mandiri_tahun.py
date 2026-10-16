"""parse_mandiri — tahun baris diambil dari nama bulan, bukan dari digit sebelum jam.

Regresi 15 Okt 2026. Kopra mencetak tanggal dan jam di baris terpisah:

    15 October 2026,
    15:00:29 <referensi> <angka>

_MDR_YEAR_TIME menjangkarkan tahun ke JAM, jadi normalnya "2026," yang terambil.
Tapi saat PEMISAH HALAMAN jatuh di antara keduanya, kop halaman ikut menyisip;
setelah kop dibuang sisanya jadi:

    15 October 2026, UBP60212399902FFFFFF420026308000   16:00:07 99102 - 1,067,220.00
                                               ^^^^

nomor referensi kini bersebelahan dengan jam dan 4 digit penutupnya terbaca
sebagai tahun. Akibatnya baris itu bertanggal 8000-10-15, penjaga
"satu statement = satu tanggal" membacanya sebagai ekspor rentang, dan
Rp 90.484.117 uang masuk yang checksum-nya COCOK tertahan dari resume.

Dua dokumen lain kena hal sama tanpa ada yang tahu: 2 Okt (tahun 8521) dan
8 Okt (tahun 5369), dua-duanya masuk sebagai 'terverifikasi'.

Dijalankan stdlib `unittest`, sama seperti test_koran_waktu.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.koran import parse_mandiri  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mdr038_15okt2026.layout.txt")


class TestMandiriTahunBaris(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE, encoding="utf-8") as fh:
            cls.hasil = parse_mandiri(fh.read())

    def test_tanggal_statement(self):
        self.assertEqual(self.hasil["tanggal"], "2026-10-15")

    def test_semua_baris_bertanggal_sama_dengan_statement(self):
        tgl = sorted({(b["waktu"] or "")[:10] for b in self.hasil["lines"] if b.get("waktu")})
        self.assertEqual(tgl, ["2026-10-15"], "tahun sampah dari nomor referensi bocor lagi")

    def test_jumlah_baris_utuh(self):
        self.assertEqual(len(self.hasil["lines"]), 21)

    def test_total_cocok_dengan_yang_tercetak(self):
        # Bukti bahwa angkanya memang benar — itu sebabnya menahan statement ini
        # merugikan: yang rusak hanya medan tanggal.
        self.assertEqual(self.hasil["total_kredit_tercetak"], 90484117.0)
        self.assertEqual(self.hasil["total_debit_tercetak"], 126746384.0)

    def test_baris_yang_terpotong_pemisah_halaman(self):
        baris = {b["urut"]: b for b in self.hasil["lines"]}
        self.assertEqual(baris[17]["waktu"], "2026-10-15 16:00:07")
        self.assertEqual(baris[17]["debit"], 1067220.0)
        # Tahun TIDAK boleh tertinggal di remark ("2026, UBP...") — gejala kedua
        # dari bug yang sama.
        self.assertFalse(baris[17]["deskripsi"].startswith("2026,"), baris[17]["deskripsi"])
        self.assertNotIn("October", baris[17]["deskripsi"])

    def test_baris_normal_remark_tidak_kemasukan_jam(self):
        # Urutan pembuangan penanda tanggal/jam sempat terbalik saat perbaikan
        # ditulis, membuat SEMUA remark diawali ", 02:15:05".
        for b in self.hasil["lines"]:
            self.assertFalse(b["deskripsi"].lstrip().startswith(","), b["deskripsi"])


if __name__ == "__main__":
    unittest.main()
