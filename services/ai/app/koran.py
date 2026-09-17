"""F-CASHIN — pembaca rekening koran harian (PDF) per bank.

Dipakai endpoint /parse-koran. Tugas modul ini MURNI membaca dokumen: keluaran
berupa header statement + daftar baris mutasi apa adanya. Klasifikasi bisnis
(mana uang masuk riil, mana dana puteran WRG) dikerjakan apps/api, bukan di
sini — pemisahan yang sama seperti DOC #KLAIM (LLM/OCR mengekstrak, aturan +
manusia yang memutuskan artinya).

Dua jalur baca, dan urutannya penting:

  1. PARSER TEKS (deterministik). 13 dari 21 file contoh punya teks digital
     presisi. Meng-OCR file semacam itu hanya menambah risiko salah digit
     tanpa manfaat, jadi parser selalu dicoba lebih dulu.

  2. OCR VISION (fallback). 8 file sisanya dicetak lewat "Microsoft Print To
     PDF" yang menggambar teks sebagai kurva — nol operator teks, tanpa objek
     /Font, jadi TIDAK ada apa pun yang bisa diekstrak (diperiksa langsung:
     INDEX 131 020926.pdf isinya 990 KB perintah kurva, Tj/TJ/BT = 0).
     Halaman dirender jadi gambar lalu dibaca model vision.

Fallback juga dipakai kalau bank-nya punya teks tapi tata kolomnya bocor saat
diekstrak (CIMB Niaga: "0.00FD TR (CR) TO", "11,210,958.90260902VG11...").
Menebak pemisah kolom dari satu contoh lebih berbahaya daripada membaca
tabelnya secara visual.

Setiap statement bank mencetak totalnya sendiri (Total Credit / Total Amount
Credited / Total Kredit). Itu dipakai sebagai CHECKSUM: kalau jumlah baris
hasil baca tidak sama dengan total tercetak, hasilnya ditandai gagal supaya
apps/api menahannya dari resume Direktur. Angka yang salah tanpa peringatan
lebih buruk daripada tidak ada angka.
"""

from __future__ import annotations

import io
import json
import re
import struct
import zlib
from typing import Any, Dict, List, Optional, Tuple

# ── util angka ───────────────────────────────────────────────────────────────
# Dua format hidup berbarengan di dokumen yang sama-sama harus dibaca:
#   Bank Jatim / Mandiri / CIMB : 1,234,567.89  (koma ribuan, titik desimal)
#   Bank Index                  : 1.234.567,89  (titik ribuan, koma desimal)
# Karena itu TIDAK ada satu fungsi "parse angka" generik — pemanggil wajib
# memilih sesuai bank. Salah pilih menggeser nilai 100x tanpa error.

_NUM_US = re.compile(r"-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}")
_NUM_ID = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}")


def num_us(s: Optional[str]) -> Optional[float]:
    """'1,234,567.89' -> 1234567.89"""
    if s is None:
        return None
    t = s.strip().replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def num_id(s: Optional[str]) -> Optional[float]:
    """'1.234.567,89' -> 1234567.89 (juga menangani '-12.978.687.120,99')"""
    if s is None:
        return None
    t = s.strip().replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def _flat(text: str) -> str:
    """Ratakan whitespace. Deskripsi transaksi sering terpotong ke baris baru di
    tengah kata-kata ('KU- RSUD SUKOWATI\\nTANGEN'), dan jam bisa terbelah
    ('23:59:\\n00'). Meratakan dulu membuat satu regex per baris transaksi
    cukup, tanpa logika penyambung baris yang rapuh."""
    return re.sub(r"[ \t]+", " ", text.replace("\r", "")).replace("\n", " ")


def _round2(x: float) -> float:
    return round(x + 0.0, 2)


def _sum_close(a: float, b: Optional[float], tol: float = 0.01) -> bool:
    """Bandingkan dua nominal rupiah. Toleransi 1 sen — pembulatan float, bukan
    kelonggaran terhadap selisih nyata."""
    if b is None:
        return False
    return abs(_round2(a) - _round2(b)) <= tol


_BULAN_EN = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _iso_date(y: int, m: int, d: int) -> str:
    return "%04d-%02d-%02d" % (y, m, d)


# ── deteksi bank ─────────────────────────────────────────────────────────────
# Sidik jari diambil dari teks header yang dicetak sistem e-banking masing-masing,
# BUKAN dari nama file. Nama file di folder sumber terbukti tidak bisa dipercaya:
# ada 'BNI 310823.pdf' (seharusnya 310826) dan 'BJTM 030926 pdf' (ekstensi rusak).

def detect_bank(text: str) -> Optional[str]:
    t = text.lower()
    if "transaction inquiry" in t and "account organization unit" in t:
        return "BJTM"
    if "kopra by mandiri" in t or ("account statement summary" in t and "opening balance" in t):
        return "MDR"
    if "mutasi rekening" in t and "saldo terblokir" in t:
        return "INDEX"
    if "daily statement of account" in t or "ledger balance" in t:
        return "NIAGA"
    return None


# ── Bank Jatim ───────────────────────────────────────────────────────────────
# Baris: <no> <dd/mm/yyyy> <hh:mm:ss> <dd/mm/yyyy> <deskripsi> IDR <debit> <kredit> <saldo> <ref>
# Deskripsi non-greedy sampai penanda ' IDR ' — itu pemisah kolom yang stabil,
# jadi deskripsi boleh memuat spasi/angka/garis miring sebebasnya.
_BJTM_ROW = re.compile(
    r"(?P<no>\d{1,3})\s+(?P<post>\d{2}/\d{2}/\d{4})\s+(?P<jam>\d{2}:\s?\d{2}:\s?\d{2})\s+"
    r"(?P<eff>\d{2}/\d{2}/\d{4})\s+(?P<desc>.*?)\s+IDR\s+"
    r"(?P<debit>[\d,]+\.\d{2})\s+(?P<kredit>[\d,]+\.\d{2})\s+(?P<saldo>[\d,]+\.\d{2})\s+(?P<ref>\S+)"
)


def parse_bjtm(text: str) -> Dict[str, Any]:
    flat = _flat(text)
    out: Dict[str, Any] = {"bank_kode": "BJTM", "lines": []}

    m = re.search(r"Account\s*:\s*(\d+)\s*/", flat)
    out["no_rekening"] = m.group(1) if m else None
    m = re.search(r"Account\s*:\s*\d+\s*/\s*(.*?)\s*\(", flat)
    out["nama_pemilik"] = m.group(1).strip() if m else None
    m = re.search(r"Account Organization Unit\s*:\s*(.*?)\s+Period", flat)
    out["cabang"] = m.group(1).strip() if m else None

    m = re.search(r"Period\s*:\s*(\d{2})/(\d{2})/(\d{4})", flat)
    if m:
        out["tanggal"] = _iso_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.search(r"Starting Balance\s*:\s*IDR\s*(-?[\d,]+\.\d{2})", flat)
    out["saldo_awal"] = num_us(m.group(1)) if m else None
    m = re.search(r"Ending Balance\s*:\s*IDR\s*(-?[\d,]+\.\d{2})", flat)
    out["saldo_akhir"] = num_us(m.group(1)) if m else None

    for r in _BJTM_ROW.finditer(flat):
        d = r.groupdict()
        dd, mm, yy = d["post"].split("/")
        jam = re.sub(r"\s+", "", d["jam"])
        out["lines"].append({
            "urut": int(d["no"]),
            "waktu": "%s %s" % (_iso_date(int(yy), int(mm), int(dd)), jam),
            "deskripsi": d["desc"].strip(),
            "debit": num_us(d["debit"]) or 0.0,
            "kredit": num_us(d["kredit"]) or 0.0,
            "saldo": num_us(d["saldo"]),
            "referensi": d["ref"],
        })

    # Baris total Bank Jatim = tiga angka terakhir sebelum 'Print Close', tanpa
    # label apa pun. Dicari dari belakang supaya tak tertukar dengan angka baris
    # transaksi.
    tail = flat.split("Print")[0]
    nums = _NUM_US.findall(tail)
    if len(nums) >= 3:
        out["total_debit_tercetak"] = num_us(nums[-3])
        out["total_kredit_tercetak"] = num_us(nums[-2])
    return out


# ── Bank Mandiri (Kopra) ─────────────────────────────────────────────────────
# Baris: <dd> <Month> <yyyy>, <hh:mm:ss> <remark ...> <ref|-> <debit> <kredit> <saldo>
# Kolom Reference No. dicetak '-' kalau kosong, jadi token terakhir sebelum tiga
# angka selalu kolom referensi — bukan bagian remark.
#
# Baris TIDAK di-anchor ke tanggal, melainkan ke tiga angka penutupnya. Alasannya
# konkret: kalau satu baris terbelah pergantian halaman, urutan ekstraksi jadi
# acak — '02 September' + potongan remark + kop halaman + '2026, 17:11:22' +
# sisa remark + angka. Regex yang menuntut '<dd> <Month> <yyyy>' berurutan
# melewatkan baris itu diam-diam (terbukti: debit 5.000,00 di Mandiri 2 Sep 2026
# hilang, selisih persis dengan total tercetak). Anchor ke angka penutup selalu
# utuh karena ketiganya dicetak berdampingan.
_MDR_AMOUNTS = re.compile(
    r"(?P<debit>[\d,]+\.\d{2})\s+(?P<kredit>[\d,]+\.\d{2})\s+(?P<saldo>[\d,]+\.\d{2})"
)
_MDR_YEAR_TIME = re.compile(r"(?P<y>\d{4}),?\s*(?P<jam>\d{2}:\s?\d{2}:\s?\d{2})")
_MDR_DAY_MON = re.compile(r"(?P<d>\d{1,2})\s+(?P<mon>[A-Za-z]{3,})")


def parse_mandiri(text: str) -> Dict[str, Any]:
    flat = _flat(text)
    out: Dict[str, Any] = {"bank_kode": "MDR", "lines": []}

    m = re.search(r"Account No\.\s*(\d+)", flat)
    out["no_rekening"] = m.group(1) if m else None
    m = re.search(r"Account Name\s*(.*?)\s*Alias", flat)
    out["nama_pemilik"] = m.group(1).strip() if m else None
    m = re.search(r"Branch\s*(.*?)\s*Opening Balance", flat)
    out["cabang"] = m.group(1).strip() if m else None

    m = re.search(r"Period\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", flat)
    if m and m.group(2).lower() in _BULAN_EN:
        out["tanggal"] = _iso_date(int(m.group(3)), _BULAN_EN[m.group(2).lower()], int(m.group(1)))
    m = re.search(r"Created\s+(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})", flat)
    if m and m.group(2).lower() in _BULAN_EN:
        out["dicetak_at"] = "%s %s" % (
            _iso_date(int(m.group(3)), _BULAN_EN[m.group(2).lower()], int(m.group(1))), m.group(4)
        )

    m = re.search(r"Opening Balance\s*(-?[\d,]+\.\d{2})", flat)
    out["saldo_awal"] = num_us(m.group(1)) if m else None
    m = re.search(r"Closing Balance\s*(-?[\d,]+\.\d{2})", flat)
    out["saldo_akhir"] = num_us(m.group(1)) if m else None
    m = re.search(r"Total Amount Debited\s*(-?[\d,]+\.\d{2})", flat)
    out["total_debit_tercetak"] = num_us(m.group(1)) if m else None
    m = re.search(r"Total Amount Credited\s*(-?[\d,]+\.\d{2})", flat)
    out["total_kredit_tercetak"] = num_us(m.group(1)) if m else None
    m = re.search(r"No\. of Debit\s*(\d+)", flat)
    out["jumlah_debit"] = int(m.group(1)) if m else None
    m = re.search(r"No\. of Credit\s*(\d+)", flat)
    out["jumlah_kredit"] = int(m.group(1)) if m else None

    # Blok summary memuat pola tanggal+angka yang mirip baris transaksi; potong
    # dulu di 'Posting Date' (header tabel) supaya tidak terbaca sebagai mutasi.
    body = flat
    idx = body.find("Posting Date")
    if idx >= 0:
        body = body[idx + len("Posting Date"):]
    # Header tabel berulang di tiap halaman ('Account Statement Created ... Page
    # N of M ... Posting Date Remark ...') — buang teks kop halaman lanjutan.
    body = re.sub(r"Account Statement Created.*?(?:koprabymandiri\.com/help)", " ", body)
    body = re.sub(r"Remark Reference No\. Debit Credit Balance", " ", body)

    urut = 0
    pos = 0
    for r in _MDR_AMOUNTS.finditer(body):
        chunk = body[pos:r.start()]
        pos = r.end()

        waktu: Optional[str] = None
        mt = _MDR_YEAR_TIME.search(chunk)
        md = _MDR_DAY_MON.search(chunk)
        if mt and md and md.group("mon").lower() in _BULAN_EN:
            waktu = "%s %s" % (
                _iso_date(int(mt.group("y")), _BULAN_EN[md.group("mon").lower()], int(md.group("d"))),
                re.sub(r"\s+", "", mt.group("jam")),
            )
        # Buang penanda tanggal/jam dari chunk supaya sisanya = remark + referensi.
        sisa = chunk
        if mt:
            sisa = sisa.replace(mt.group(0), " ")
        if md:
            sisa = sisa.replace(md.group(0), " ", 1)
        sisa = re.sub(r"\s+", " ", sisa).strip()

        ref: Optional[str] = None
        parts = sisa.rsplit(" ", 1)
        if sisa == "-":
            sisa = ""
        elif len(parts) == 2:
            if parts[1] == "-":
                sisa, ref = parts[0], None
            else:
                sisa, ref = parts[0], parts[1]

        urut += 1
        out["lines"].append({
            "urut": urut,
            "waktu": waktu,
            "deskripsi": sisa.strip(),
            "debit": num_us(r.group("debit")) or 0.0,
            "kredit": num_us(r.group("kredit")) or 0.0,
            "saldo": num_us(r.group("saldo")),
            "referensi": ref,
        })
    return out


# ── Bank Index ───────────────────────────────────────────────────────────────
# Format angka Indonesia (titik ribuan, koma desimal) dan kolom Status C/D
# menentukan arah — bukan dua kolom debit/kredit terpisah seperti bank lain.
# Rekening ini PRK (pinjaman): saldo normalnya NEGATIF, jadi tanda minus wajib
# ikut terbaca.
_INDEX_ROW = re.compile(
    r"(?P<tgl>\d{2}/\d{2}/\d{4})\s+(?P<desc>.*?)\s+(?P<status>[CD])\s+"
    r"(?P<nominal>-?[\d.]+,\d{2})\s+(?P<saldo>-?[\d.]+,\d{2})"
)


def parse_index(text: str) -> Dict[str, Any]:
    flat = _flat(text)
    out: Dict[str, Any] = {"bank_kode": "INDEX", "lines": []}

    m = re.search(r"Nomor Rekening\s*(\d+)", flat)
    out["no_rekening"] = m.group(1) if m else None
    m = re.search(r"Nama\s+(.*?)\s+Nomor Rekening", flat)
    out["nama_pemilik"] = m.group(1).strip() if m else None

    m = re.search(r"Periode\s*(\d{2})/(\d{2})/(\d{4})", flat)
    if m:
        out["tanggal"] = _iso_date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    m = re.search(r"Tanggal Download\s*(\d{2})-([A-Za-z]{3})-(\d{4})\s*/\s*(\d{2}:\d{2}:\d{2})", flat)
    if m and m.group(2).lower() in _BULAN_EN:
        out["dicetak_at"] = "%s %s" % (
            _iso_date(int(m.group(3)), _BULAN_EN[m.group(2).lower()], int(m.group(1))), m.group(4)
        )

    m = re.search(r"Saldo Awal\s*(-?[\d.]+,\d{2})", flat)
    out["saldo_awal"] = num_id(m.group(1)) if m else None
    m = re.search(r"Saldo Akhir\s*(-?[\d.]+,\d{2})", flat)
    out["saldo_akhir"] = num_id(m.group(1)) if m else None
    m = re.search(r"Total Kredit\s*(-?[\d.]+,\d{2})", flat)
    out["total_kredit_tercetak"] = num_id(m.group(1)) if m else None
    m = re.search(r"Total Debet\s*(-?[\d.]+,\d{2})", flat)
    out["total_debit_tercetak"] = num_id(m.group(1)) if m else None

    body = flat
    idx = body.find("Tanggal Deskripsi Transaksi Status Nominal Saldo")
    if idx >= 0:
        body = body[idx:]
    urut = 0
    for r in _INDEX_ROW.finditer(body):
        d = r.groupdict()
        dd, mm, yy = d["tgl"].split("/")
        nominal = num_id(d["nominal"]) or 0.0
        urut += 1
        out["lines"].append({
            "urut": urut,
            "waktu": None,  # Bank Index tidak mencetak jam transaksi
            "deskripsi": re.sub(r"\s+", " ", d["desc"]).strip(),
            "debit": nominal if d["status"] == "D" else 0.0,
            "kredit": nominal if d["status"] == "C" else 0.0,
            "saldo": num_id(d["saldo"]),
            "referensi": None,
        })
    return out


# CIMB Niaga sengaja TIDAK punya parser teks. Ekstraksi teksnya membocorkan
# kolom satu ke kolom lain ('0.00FD TR (CR) TO', '11,210,958.90260902VG11...'),
# jadi angka dan deskripsi menempel tanpa pemisah yang bisa dipercaya. Dengan
# satu contoh dokumen, menebak batas kolom lebih berbahaya daripada membaca
# tabelnya lewat vision — jadi NIAGA jatuh ke jalur OCR.
_PARSERS = {"BJTM": parse_bjtm, "MDR": parse_mandiri, "INDEX": parse_index}


# ── ekstraksi teks & render halaman ──────────────────────────────────────────

def pdf_text(pdf_bytes: bytes) -> str:
    """Teks seluruh halaman. String kosong = PDF tanpa operator teks (hasil
    'Print To PDF' yang menggambar huruf sebagai kurva) → wajib OCR."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def _png_bytes(buffer: Any, width: int, height: int, stride: int, mode: str) -> bytes:
    """Bungkus bitmap mentah pypdfium2 jadi PNG memakai stdlib (zlib + struct).

    Sengaja TIDAK memakai bitmap.to_pil(): itu menyeret Pillow sebagai
    dependensi ketiga ke venv produksi yang masih terpaku Python 3.9 (lihat
    requirements.txt). Encoder di bawah ~15 baris, filter 0 per baris, dan sudah
    diuji pada halaman 1224x1584 → PNG 183 KB dalam 0,04 detik.
    """
    per_pixel = {"RGB": 3, "RGBA": 4, "L": 1}.get(mode)
    color_type = {"RGB": 2, "RGBA": 6, "L": 0}.get(mode)
    if per_pixel is None or color_type is None:
        raise RuntimeError("mode bitmap tak didukung: %s" % mode)

    mv = memoryview(buffer)
    row_bytes = width * per_pixel
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) per baris
        raw += mv[y * stride: y * stride + row_bytes]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )


def pdf_page_images(pdf_bytes: bytes, scale: float = 2.0, max_pages: int = 4) -> List[str]:
    """Render halaman jadi PNG base64 untuk dibaca model vision.

    scale 2.0 (~144 dpi) — sudah terbukti cukup membaca angka rekening koran
    (diperiksa langsung pada statement Bank Index/Hana/BNI) tanpa membuat
    payload base64 membengkak. max_pages menahan statement panjang (Mandiri
    bisa 3 halaman) supaya satu permintaan tidak meledak.

    rev_byteorder=True membuat pypdfium2 mengembalikan RGB, bukan BGR bawaannya
    — tanpa itu warna tertukar dan tak ada gunanya menukar byte di Python.
    """
    import base64

    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf_bytes)
    out: List[str] = []
    for i in range(min(len(doc), max_pages)):
        bitmap = doc[i].render(scale=scale, rev_byteorder=True)
        png = _png_bytes(bitmap.buffer, bitmap.width, bitmap.height, bitmap.stride, bitmap.mode)
        out.append(base64.b64encode(png).decode("ascii"))
    return out


# ── prompt OCR ───────────────────────────────────────────────────────────────

_OCR_SYSTEM = (
    "Kamu adalah pembaca rekening koran (mutasi rekening) bank Indonesia untuk "
    "PT Wahana Rizky Gumilang. Baca gambar halaman rekening koran yang diberikan "
    "dan salin isi tabel mutasinya apa adanya.\n"
    "Balas HANYA dengan JSON valid (tanpa markdown code-fence, tanpa penjelasan), "
    "bentuk persis:\n"
    '{"no_rekening": string|null, "nama_pemilik": string|null, '
    '"tanggal": "YYYY-MM-DD"|null, "saldo_awal": number|null, "saldo_akhir": number|null, '
    '"total_debit_tercetak": number|null, "total_kredit_tercetak": number|null, '
    '"lines": [{"waktu": string|null, "deskripsi": string, "debit": number, '
    '"kredit": number, "saldo": number|null, "referensi": string|null}]}\n'
    "Aturan yang TIDAK boleh dilanggar:\n"
    "- Semua nominal ditulis sebagai angka JSON polos: 1234567.89 (titik desimal, "
    "TANPA pemisah ribuan, TANPA 'Rp'). Dokumen bank Indonesia sering memakai "
    "titik sebagai pemisah ribuan dan koma sebagai desimal — konversi dengan benar.\n"
    "- Baris yang tidak ada nilainya di kolom debit atau kredit diisi 0, bukan null.\n"
    "- Saldo rekening pinjaman/PRK bisa NEGATIF — pertahankan tanda minusnya.\n"
    "- deskripsi disalin apa adanya seperti tercetak, termasuk singkatan dan salah "
    "ejaan bank. JANGAN dirapikan, diterjemahkan, atau ditafsirkan.\n"
    "- total_debit_tercetak / total_kredit_tercetak diambil dari angka TOTAL yang "
    "dicetak di dokumen (Total Debit / Total Credit / Total Amount Credited / "
    "Total Kredit / Total Debet). JANGAN dihitung sendiri dari penjumlahan baris — "
    "angka itu dipakai untuk memeriksa hasil bacaanmu.\n"
    "- Kalau sebuah nilai tidak terbaca, isi null. JANGAN mengarang angka."
)


def build_koran_ocr_system() -> str:
    return _OCR_SYSTEM


def build_koran_ocr_user(file_nama: Optional[str], halaman: int, total_halaman: int) -> str:
    ket = "Halaman %d dari %d." % (halaman, total_halaman)
    if file_nama:
        # Nama file diberikan sebagai KONTEKS bank saja. Model diminta eksplisit
        # tidak memungut tanggal dari sana: nama file di folder sumber terbukti
        # salah ('BNI 310823.pdf' untuk mutasi 31 Agustus 2026).
        return (
            "%s Nama file: \"%s\" (petunjuk bank saja — JANGAN ambil tanggal dari "
            "nama file, pakai tanggal yang tercetak di dokumen). Baca tabel mutasi "
            "di gambar ini." % (ket, file_nama)
        )
    return "%s Baca tabel mutasi di gambar ini." % ket


def parse_ocr_json(text: str) -> Dict[str, Any]:
    """Parse respons LLM. Gagal parse -> dict kosong (bukan exception): pemanggil
    menandainya gagal checksum sehingga statement masuk 'perlu_review', bukan
    diam-diam dianggap nol transaksi."""
    try:
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        data = json.loads(cleaned)
    except (json.JSONDecodeError, AttributeError, TypeError):
        return {"lines": [], "parse_error": "respons OCR bukan JSON valid"}
    if not isinstance(data, dict):
        return {"lines": [], "parse_error": "respons OCR bukan objek JSON"}

    lines: List[Dict[str, Any]] = []
    for i, raw in enumerate(data.get("lines") or []):
        if not isinstance(raw, dict):
            continue
        lines.append({
            "urut": i + 1,
            "waktu": raw.get("waktu"),
            "deskripsi": str(raw.get("deskripsi") or "").strip(),
            "debit": _as_float(raw.get("debit")) or 0.0,
            "kredit": _as_float(raw.get("kredit")) or 0.0,
            "saldo": _as_float(raw.get("saldo")),
            "referensi": raw.get("referensi"),
        })
    return {
        "no_rekening": data.get("no_rekening"),
        "nama_pemilik": data.get("nama_pemilik"),
        "tanggal": data.get("tanggal"),
        "saldo_awal": _as_float(data.get("saldo_awal")),
        "saldo_akhir": _as_float(data.get("saldo_akhir")),
        "total_debit_tercetak": _as_float(data.get("total_debit_tercetak")),
        "total_kredit_tercetak": _as_float(data.get("total_kredit_tercetak")),
        "lines": lines,
    }


def merge_ocr_pages(pages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Gabungkan hasil OCR beberapa halaman jadi satu statement.

    Field header (no_rekening, tanggal, saldo_awal) diambil dari halaman
    PERTAMA yang punya nilainya — biasanya halaman 1. Total tercetak diambil
    dari halaman TERAKHIR yang punya nilainya: blok ringkasan dicetak di akhir
    dokumen, dan halaman lanjutan sering mengulang kop tanpa total.
    """
    out: Dict[str, Any] = {"lines": []}
    head_keys = ("no_rekening", "nama_pemilik", "tanggal", "saldo_awal")
    tail_keys = ("saldo_akhir", "total_debit_tercetak", "total_kredit_tercetak")
    for p in pages:
        for kk in head_keys:
            if out.get(kk) is None and p.get(kk) is not None:
                out[kk] = p.get(kk)
        for kk in tail_keys:
            if p.get(kk) is not None:
                out[kk] = p.get(kk)
        for line in p.get("lines") or []:
            item = dict(line)
            item["urut"] = len(out["lines"]) + 1
            out["lines"].append(item)
    errs = [p["parse_error"] for p in pages if p.get("parse_error")]
    if errs:
        out["parse_error"] = "; ".join(errs)
    return out


def _as_float(x: Any) -> Optional[float]:
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        # Model kadang tetap mengirim '1.234.567,89' walau diminta angka polos.
        s = x.strip().replace("Rp", "").replace(" ", "")
        if not s:
            return None
        if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+,\d{1,2}", s):
            return num_id(s)
        return num_us(s.replace(",", ""))
    return None


# ── checksum ─────────────────────────────────────────────────────────────────

def apply_checksum(res: Dict[str, Any]) -> Dict[str, Any]:
    """Bandingkan jumlah baris dengan total yang DICETAK bank.

    checksum_ok=None kalau bank tidak mencetak total sama sekali (tak bisa
    dinilai) — dibedakan dari False (dinilai dan TIDAK cocok). apps/api
    memperlakukan keduanya sebagai 'belum terverifikasi', tapi pesan ke
    penggunanya beda dan itu penting saat menelusuri masalah.
    """
    lines = res.get("lines") or []
    sum_debit = _round2(sum(float(l.get("debit") or 0) for l in lines))
    sum_kredit = _round2(sum(float(l.get("kredit") or 0) for l in lines))
    res["jumlah_baris"] = len(lines)
    res["sum_debit"] = sum_debit
    res["sum_kredit"] = sum_kredit

    td = res.get("total_debit_tercetak")
    tk = res.get("total_kredit_tercetak")
    if td is None and tk is None:
        res["checksum_ok"] = None
        return res

    ok_d = td is None or _sum_close(sum_debit, td)
    ok_k = tk is None or _sum_close(sum_kredit, tk)
    res["checksum_ok"] = bool(ok_d and ok_k)
    if not res["checksum_ok"]:
        bagian = []
        if not ok_d:
            bagian.append("debit baris %.2f != total tercetak %.2f" % (sum_debit, td))
        if not ok_k:
            bagian.append("kredit baris %.2f != total tercetak %.2f" % (sum_kredit, tk))
        res["parse_error"] = "checksum gagal: " + "; ".join(bagian)
    return res


# ── entry point parser teks ──────────────────────────────────────────────────

def parse_text_pdf(pdf_bytes: bytes) -> Tuple[Dict[str, Any], str]:
    """Coba baca lewat parser teks.

    Mengembalikan (hasil, teks_mentah). hasil["needs_ocr"]=True berarti jalur
    teks tidak bisa dipakai (tanpa teks, bank tak dikenali, bank tanpa parser,
    atau checksum gagal) dan pemanggil harus lanjut ke OCR.
    """
    try:
        text = pdf_text(pdf_bytes)
    except Exception as e:  # noqa: BLE001 — PDF rusak/terenkripsi tetap harus dilaporkan, bukan 500
        return ({"needs_ocr": True, "lines": [], "parse_error": "gagal baca PDF: %s" % e}, "")

    if not text.strip():
        return ({"needs_ocr": True, "lines": [],
                 "parse_error": "PDF tanpa teks (kemungkinan hasil Print To PDF / scan)"}, "")

    bank = detect_bank(text)
    if bank is None:
        return ({"needs_ocr": True, "lines": [], "raw_text": text,
                 "parse_error": "bank tidak dikenali dari isi dokumen"}, text)

    parser = _PARSERS.get(bank)
    if parser is None:
        return ({"needs_ocr": True, "lines": [], "bank_kode": bank, "raw_text": text,
                 "parse_error": "bank %s belum punya parser teks (tata kolomnya bocor saat diekstrak)" % bank},
                text)

    try:
        res = parser(text)
    except Exception as e:  # noqa: BLE001
        return ({"needs_ocr": True, "lines": [], "bank_kode": bank, "raw_text": text,
                 "parse_error": "parser %s gagal: %s" % (bank, e)}, text)

    res["raw_text"] = text
    res["metode"] = "parser"
    res = apply_checksum(res)
    res["needs_ocr"] = res.get("checksum_ok") is not True
    return (res, text)
