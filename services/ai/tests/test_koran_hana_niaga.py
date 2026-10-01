"""Parser teks KEB Hana & CIMB Niaga — F-CASHIN.

Sampai Okt 2026 kedua bank ini selalu jatuh ke OCR vision (OpenRouter) padahal
PDF-nya punya teks digital. Fixture di sini adalah keluaran SUNGGUHAN pypdf
atas koran produksi:

  hana_21sep2026.txt          extract_text()                 Hana 21 Sep 2026
  hana_25sep2026.txt          extract_text()                 Hana 25–27 Sep 2026
  niaga_30sep2026.layout.txt  extract_text(mode="layout")    CIMB Niaga 30 Sep 2026

Nilai harapan = baris yang tersimpan di bank_statement_line produksi dari OCR
vision (gemini-3.8-flash, status terverifikasi). Parser teks wajib menghasilkan
angka yang SAMA — satu-satunya beda yang disengaja adalah saldo_awal NIAGA
(lihat test_saldo_awal_niaga_bukan_yesterday_balance).

Dijalankan stdlib `unittest` (tanpa pytest), sama seperti test_koran_bni.py.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.koran import (  # noqa: E402
    _tanggal_periode,
    apply_checksum,
    detect_bank,
    parse_hana,
    parse_niaga,
)

HERE = os.path.dirname(os.path.abspath(__file__))


def fixture(nama: str) -> str:
    with open(os.path.join(HERE, nama), encoding="utf-8") as fh:
        return fh.read()


def ringkas(res):
    return [(l["deskripsi"], l["debit"], l["kredit"], l["saldo"]) for l in res["lines"]]


class DeteksiBank(unittest.TestCase):
    def test_hana_dikenali(self):
        self.assertEqual(detect_bank(fixture("hana_21sep2026.txt")), "HANA")
        self.assertEqual(detect_bank(fixture("hana_25sep2026.txt")), "HANA")

    def test_niaga_dikenali(self):
        self.assertEqual(detect_bank(fixture("niaga_30sep2026.layout.txt")), "NIAGA")

    def test_judul_transaction_history_saja_bukan_hana(self):
        # Bukti transfer BNI berjudul 'TRANSACTION HISTORY' — tanpa kolom
        # Billing ID (VA) itu bukan koran Hana.
        self.assertIsNone(detect_bank("Account Transaction History\nDate Remark Debit Credit"))


class ParserHana(unittest.TestCase):
    def test_satu_baris_kredit_saldo_negatif(self):
        res = apply_checksum(parse_hana(fixture("hana_21sep2026.txt")))
        self.assertTrue(res["checksum_ok"], res.get("parse_error"))
        self.assertEqual(res["no_rekening"], "17777999777")
        self.assertEqual(res["tanggal"], "2026-09-21")
        self.assertEqual(res["saldo_awal"], -3955555438.33)
        self.assertEqual(res["saldo_akhir"], -3944004753.33)
        self.assertEqual(ringkas(res), [
            ("BUNGA(20/08/20 26~19/09/2026)", 0.0, 11550685.0, -3944004753.33),
        ])

    def test_empat_baris_sama_dengan_ocr_vision(self):
        res = apply_checksum(parse_hana(fixture("hana_25sep2026.txt")))
        self.assertTrue(res["checksum_ok"], res.get("parse_error"))
        self.assertEqual(res["total_debit_tercetak"], 41110421.03)
        self.assertEqual(res["total_kredit_tercetak"], 15000000.0)
        self.assertEqual(ringkas(res), [
            ("Fee BI Fast", 2500.0, 0.0, -3970115174.36),
            ("Others", 11550685.0, 0.0, -3970112674.36),
            ("BFAST BANK MANDIRI WAHANA RIZKY GUMILAN BI FAST Transfer BMRIIDJAXXX",
             0.0, 15000000.0, -3958561989.36),
            ("BUNGA JATUH TEMPO(09/2026)", 29557236.03, 0.0, -3973561989.36),
        ])
        self.assertTrue(all(l["waktu"] is None and l["referensi"] is None for l in res["lines"]))

    def test_periode_tiga_hari_semua_baris_satu_tanggal(self):
        # 'Periode 25/09/2026 - 27/09/2026', semua mutasi tgl 25 → tanggal 25.
        res = parse_hana(fixture("hana_25sep2026.txt"))
        self.assertEqual(res["tanggal"], "2026-09-25")
        self.assertNotIn("parse_error", res)


class ParserNiaga(unittest.TestCase):
    def test_tiga_baris_sama_dengan_ocr_vision(self):
        res = apply_checksum(parse_niaga(fixture("niaga_30sep2026.layout.txt")))
        self.assertTrue(res["checksum_ok"], res.get("parse_error"))
        self.assertEqual(res["no_rekening"], "860013719700")
        self.assertEqual(res["nama_pemilik"], "WAHANA RIZKY GUMILANG")
        self.assertEqual(res["tanggal"], "2026-09-30")
        self.assertEqual(res["saldo_akhir"], 13107210.06)
        self.assertEqual(res["dicetak_at"], "2026-10-01 14:57:08")
        self.assertEqual(ringkas(res), [
            ("MONTHLY ADMIN FEE", 30000.0, 0.0, 13107210.06),
            ("WITHHOLDING TAX", 188.83, 0.0, 13137210.06),
            ("CREDIT PROFIT/HIBAH", 0.0, 944.15, 13137398.89),
        ])
        self.assertEqual([l["referensi"] for l in res["lines"]],
                         ["DD4400074009120", "DD4400074009119", "DD4400074009118"])
        self.assertTrue(all(l["waktu"] == "2026-09-30 23:59:59" for l in res["lines"]))

    def test_saldo_awal_niaga_bukan_yesterday_balance(self):
        # CIMB mencetak 'Yesterday Balance 0.00'; OCR vision menyalinnya apa
        # adanya sehingga cek saldo bersambung gagal. Saldo awal sebenarnya =
        # 13.107.210,06 − 944,15 + 30.188,83.
        res = parse_niaga(fixture("niaga_30sep2026.layout.txt"))
        self.assertEqual(res["saldo_awal"], 13136454.74)

    def test_kop_halaman_tak_tertelan_jadi_deskripsi(self):
        teks = fixture("niaga_30sep2026.layout.txt").replace(
            "   Generated On", " Company ID                   ID47168WRG\n   Generated On")
        res = parse_niaga(teks)
        self.assertEqual(res["lines"][-1]["deskripsi"], "CREDIT PROFIT/HIBAH")


class TanggalPeriode(unittest.TestCase):
    def test_satu_hari(self):
        self.assertEqual(_tanggal_periode("2026-09-21", "2026-09-21", []), ("2026-09-21", None))

    def test_multi_hari_baris_tersebar_ditolak(self):
        tgl, err = _tanggal_periode("2026-09-25", "2026-09-27", ["2026-09-25", "2026-09-26"])
        self.assertIsNone(tgl)
        self.assertIn("lebih dari satu hari", err)

    def test_multi_hari_tanpa_baris_ditolak(self):
        tgl, err = _tanggal_periode("2026-09-25", "2026-09-27", [])
        self.assertIsNone(tgl)
        self.assertIsNotNone(err)

    def test_baris_di_luar_periode_ditolak(self):
        tgl, _ = _tanggal_periode("2026-09-25", "2026-09-27", ["2026-09-28"])
        self.assertIsNone(tgl)


if __name__ == "__main__":
    unittest.main()
