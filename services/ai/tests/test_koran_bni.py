"""Parser BNI (TRANSACTION INQUIRY) — F-CASHIN.

Fixture `bni_24sep2026.layout.txt` adalah keluaran SUNGGUHAN
`extract_text(extraction_mode="layout")` atas koran BNI 24 Sep 2026 yang
ditolak produksi 25 Sep 2026 pagi. Bukan karangan: yang membuat parser koran
mudah salah bukan kasus buatan, tapi tata kolom yang sebenarnya.

Dijalankan stdlib `unittest` (tanpa pytest) supaya tak menambah dependensi ke
requirements.txt yang ikut terpasang di produksi.
"""

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.koran import apply_checksum, detect_bank, parse_bni  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bni_24sep2026.layout.txt")


def layout() -> str:
    with open(FIXTURE, encoding="utf-8") as fh:
        return fh.read()


class DeteksiBank(unittest.TestCase):
    def test_bni_dikenali_dari_isi_bukan_nama_file(self):
        # 25 Sep 2026: detect_bank mengembalikan None untuk koran BNI, jadi
        # SELURUH file dilempar ke OCR — padahal teksnya terbaca sempurna.
        self.assertEqual(detect_bank(layout()), "BNI")

    def test_kata_bni_memang_tak_ada_di_teks(self):
        # Sidik jarinya tak boleh bergantung pada string 'BNI': logonya gambar.
        # Kalau suatu saat ini gagal, sidik jarinya boleh disederhanakan.
        self.assertNotIn("bni", layout().lower())

    def test_bjtm_tidak_tertukar_jadi_bni(self):
        # Keduanya memakai judul 'TRANSACTION INQUIRY'. BJTM dinilai lebih dulu;
        # kalau urutannya terbalik, koran Bank Jatim akan diparse sebagai BNI.
        bjtm = "TRANSACTION INQUIRY\nAccount Organization Unit : 0001\nPost Date\n"
        self.assertEqual(detect_bank(bjtm), "BJTM")

    def test_bukti_transfer_bni_bukan_koran(self):
        # File 'BNI_*.pdf' di folder inbound kebanyakan bukti transfer
        # ('TRANSACTION HISTORY'), bukan rekening koran. Tak boleh ikut tercatat
        # sebagai mutasi.
        self.assertIsNone(detect_bank("TRANSACTION HISTORY\nAction Date Action Type Amount\n"))


class HeaderBni(unittest.TestCase):
    def setUp(self):
        self.r = parse_bni(layout())

    def test_tanggal_dari_isi_dokumen(self):
        # Inti perbaikan: tanggal ADA di dokumen dan harus terbaca dari sana,
        # bukan dari nama file (nama file terbukti bisa salah — 'BNI 310823.pdf'
        # untuk mutasi 31 Agustus 2026).
        self.assertEqual(self.r["tanggal"], "2026-09-24")

    def test_rekening_dan_pemilik(self):
        self.assertEqual(self.r["no_rekening"], "1586200460")
        self.assertEqual(self.r["nama_pemilik"], "WAHANA RIZKY GUMILANG PT")

    def test_saldo_dan_total_tercetak(self):
        self.assertEqual(self.r["saldo_awal"], 130870157.00)
        self.assertEqual(self.r["total_debit_tercetak"], 0.00)
        self.assertEqual(self.r["total_kredit_tercetak"], 106483050.00)

    def test_saldo_akhir_dari_baris_terakhir(self):
        # BNI tak mencetak 'Ending Balance'; satu-satunya sumber saldo akhir
        # adalah kolom Balance baris terakhir.
        self.assertEqual(self.r["saldo_akhir"], 237353207.00)

    def test_saldo_akhir_konsisten_dengan_mutasi(self):
        r = self.r
        self.assertAlmostEqual(
            r["saldo_awal"] + r["total_kredit_tercetak"] - r["total_debit_tercetak"],
            r["saldo_akhir"],
            places=2,
        )


class BarisMutasi(unittest.TestCase):
    def setUp(self):
        self.r = parse_bni(layout())
        self.baris = self.r["lines"]

    def test_satu_baris_kredit(self):
        self.assertEqual(len(self.baris), 1)
        b = self.baris[0]
        self.assertEqual(b["kredit"], 106483050.00)
        self.assertEqual(b["debit"], 0.0)
        self.assertEqual(b["saldo"], 237353207.00)
        self.assertEqual(b["referensi"], "964223")

    def test_jam_diambil_dari_baris_lanjutan(self):
        # Jam dicetak DI BAWAH tanggal, bukan di kolomnya sendiri.
        self.assertEqual(self.baris[0]["waktu"], "18:25:14")

    def test_deskripsi_tidak_menelan_kolom_branch(self):
        # Regresi paling mudah terjadi di sini: tanpa pemotongan kolom, kata
        # 'BANKING' (lanjutan Branch 'INTERNET BANKING') masuk ke tengah
        # deskripsi — 'PEMINDAHAN DARI BANKING 1420075012038'.
        desc = self.baris[0]["deskripsi"]
        self.assertNotIn("BANKING", desc)
        self.assertIn("TRF/PAY/TOP-UP ECHANNEL", desc)
        self.assertIn("BI FAST Transfer", desc)

    def test_deskripsi_menyambung_semua_baris_lanjutan(self):
        # Deskripsi terpecah 3 baris di PDF; nomor rekening lawan ada di baris
        # ke-2 dan itu yang dipakai aturan klasifikasi puteran/afiliasi.
        self.assertIn("1420075012038", self.baris[0]["deskripsi"])

    def test_angka_tidak_menempel(self):
        # Pada teks urutan-baca, baris ini keluar sebagai
        # '237,353,207.001 C106,483,050.00' — saldo + no + Db/Cr + nominal
        # menempel. Mode layout yang memisahkannya; ini penjaganya.
        for b in self.baris:
            self.assertLess(b["kredit"], 200000000.00)
            self.assertNotEqual(b["kredit"], b["saldo"])


class Checksum(unittest.TestCase):
    def test_checksum_lolos_sehingga_tidak_perlu_ocr(self):
        # Inilah yang membuat parser ini aman dibuat dari SATU contoh dokumen:
        # parse_text_pdf menetapkan needs_ocr = checksum_ok is not True, jadi
        # salah baca tak pernah lolos jadi angka — ia jatuh ke OCR.
        r = apply_checksum(parse_bni(layout()))
        self.assertIs(r["checksum_ok"], True)
        self.assertEqual(r["sum_kredit"], r["total_kredit_tercetak"])
        self.assertEqual(r["sum_debit"], r["total_debit_tercetak"])

    def test_salah_baca_ketahuan_checksum(self):
        # Bukti bahwa jaring pengamannya benar-benar menangkap, bukan asumsi:
        # satu baris dihapus → checksum WAJIB gagal.
        r = parse_bni(layout())
        r["lines"] = []
        self.assertIs(apply_checksum(r)["checksum_ok"], False)


class PeriodeLebihDariSehari(unittest.TestCase):
    def test_rentang_tidak_dipadatkan_jadi_satu_tanggal(self):
        # Koran harian WRG satu tanggal per file. Kalau rentangnya >1 hari,
        # memaksakan satu tanggal akan menyimpan semua mutasi di tanggal yang
        # salah TANPA error — persis kelas kegagalan yang dihindari fitur ini.
        teks = layout().replace(
            "Period                              :    24-Sep-2026                 -   24-Sep-2026",
            "Period                              :    22-Sep-2026                 -   24-Sep-2026",
        )
        r = parse_bni(teks)
        self.assertIsNone(r.get("tanggal"))
        self.assertEqual(r.get("periode_dari"), "2026-09-22")
        self.assertEqual(r.get("periode_sampai"), "2026-09-24")
        self.assertIn("lebih dari satu hari", r["parse_error"])

    def test_fixture_memang_periode_sehari(self):
        # Menjaga tes di atas tetap bermakna kalau fixture-nya diganti.
        self.assertRegex(layout(), re.compile(r"^Period\s*:\s*24-Sep-2026\s*-\s*24-Sep-2026", re.M))


if __name__ == "__main__":
    unittest.main()
