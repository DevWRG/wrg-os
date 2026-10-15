import datetime
import os
import re
import shutil
import subprocess
import tempfile
from typing import List, Optional, Tuple

# DOC #KLAIM — OCR nota reimburse pakai Tesseract LOKAL (keputusan user 15 Okt
# 2026: tanpa token LLM). Tesseract hanya menghasilkan teks mentah; nomor,
# tanggal, nominal, dan pihak dicari dengan pola di bawah. Prinsipnya sama
# dengan versi LLM sebelumnya: field yang tak yakin dibiarkan KOSONG, bukan
# ditebak — approver mengisi dari foto (thumbnail ada di menu Klaim OCR).
#
# Batas yang jujur: nota tulisan tangan, foto miring/gelap, dan kertas thermal
# pudar sering tak terbaca. Itu sebabnya nominal disetujui wajib diisi HoD
# kalau nominal nota kosong (lihat decideKlaim di apps/api).

# Dua mode segmentasi: psm 6 (blok teks seragam) paling banyak menangkap baris
# struk, psm 11 (teks tercecer) menangkap baris yang psm 6 lewatkan. Ekstraksi
# dijalankan atas gabungan keduanya; raw_text = psm 6 (paling mirip tata letak).
_PSM = ("6", "11")
_TIMEOUT_S = 30


def tesseract_cmd() -> Optional[str]:
    """Lokasi binary tesseract. pm2 di Mac mini tak selalu membawa
    /opt/homebrew/bin di PATH, jadi lokasi Homebrew dicoba eksplisit."""
    env = os.environ.get("TESSERACT_CMD")
    if env and os.path.exists(env):
        return env
    found = shutil.which("tesseract")
    if found:
        return found
    for p in ("/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "/usr/bin/tesseract"):
        if os.path.exists(p):
            return p
    return None


def jalankan_tesseract(image: bytes, suffix: str) -> Tuple[str, List[str]]:
    """Jalankan tesseract (ind+eng) untuk tiap mode psm. Mengembalikan
    (path binary, daftar teks per mode). Raise RuntimeError kalau binary tak ada."""
    cmd = tesseract_cmd()
    if not cmd:
        raise RuntimeError("binary tesseract tidak ditemukan (set TESSERACT_CMD)")
    with tempfile.NamedTemporaryFile(suffix=suffix or ".jpg") as f:
        f.write(image)
        f.flush()
        hasil = []
        for psm in _PSM:
            out = subprocess.run(
                [cmd, f.name, "-", "-l", "ind+eng", "--psm", psm, "-c", "preserve_interword_spaces=1"],
                capture_output=True,
                timeout=_TIMEOUT_S,
                check=False,
            )
            if out.returncode != 0:
                raise RuntimeError(f"tesseract psm {psm} gagal: {out.stderr.decode(errors='replace')[:200]}")
            hasil.append(out.stdout.decode("utf-8", errors="replace"))
    return cmd, hasil


# ── Ekstraksi (pure — diuji di tests/test_klaim_ekstrak.py) ─────────────────

_ANGKA = r"\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{4,9}"
# Huruf pertama "total" sering hilang/terbaca '[', 'l', 'I', '|' di struk thermal.
_TOTAL = r"(?:[t\[\]|lI1]?[o0]tal|jumlah|tagihan)"
# Baris ber-kata "total" yang BUKAN total belanja.
_BUKAN_TOTAL = re.compile(
    r"item|qty|disc|diskon|potongan|hemat|tunai|cash|kembali|change|ppn|pajak|dpp|tax|poin|point|saldo", re.I
)
# Baris total yang PALING dipercaya (belanja/bayar/tagihan/grand).
_TOTAL_KUAT = re.compile(
    rf"{_TOTAL}\s*(?:belanja|bayar|harga|tagihan|pembayaran|akhir)|grand\s*total|jumlah\s*(?:bayar|tagihan)", re.I
)
_TOTAL_LEMAH = re.compile(rf"{_TOTAL}\b", re.I)


def _angka_terakhir(baris: str) -> Optional[str]:
    temu = re.findall(_ANGKA, baris)
    return temu[-1] if temu else None


def cari_nominal(teks: str) -> Optional[str]:
    """Nominal total belanja dari baris berlabel total. Tanpa label → None
    (angka terbesar sering = uang TUNAI yang dibayarkan, bukan total)."""
    baris = [b.strip() for b in teks.splitlines() if b.strip()]
    for pola in (_TOTAL_KUAT, _TOTAL_LEMAH):
        for i, b in enumerate(baris):
            if not pola.search(b) or (pola is _TOTAL_LEMAH and _BUKAN_TOTAL.search(b)):
                continue
            n = _angka_terakhir(b)
            if n is None and i + 1 < len(baris) and not re.search(r"[a-z]{3}", baris[i + 1], re.I):
                n = _angka_terakhir(baris[i + 1])  # label & angka beda baris
            if n:
                return n
    return None


_BULAN = r"jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec"
_TGL_ANGKA = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b")
_TGL_KATA = re.compile(rf"\b(\d{{1,2}})\s*(?:{_BULAN})[a-z]*\.?\s*(\d{{4}}|\d{{2}})\b", re.I)


def _tahun_wajar(raw: str, sekarang: int) -> bool:
    """Klaim reimburse selalu baru: tahun di luar [tahun lalu, tahun ini]
    hampir pasti salah baca (uji 15 Okt: 2026 terbaca 2006). Lebih baik kosong
    daripada tanggal salah yang meyakinkan."""
    y = int(raw)
    if y < 100:
        y += 2000
    return sekarang - 1 <= y <= sekarang


def cari_tanggal(teks: str, tahun_sekarang: Optional[int] = None) -> Optional[str]:
    """Tanggal tercetak apa adanya (tak diformat ulang). Hari/bulan divalidasi
    supaya nomor telepon/NPWP tak ikut terbaca sebagai tanggal; tahun harus
    wajar (lihat _tahun_wajar)."""
    sekarang = tahun_sekarang or datetime.date.today().year
    for m in _TGL_ANGKA.finditer(teks):
        d, mth = int(m.group(1)), int(m.group(2))
        if 1 <= d <= 31 and 1 <= mth <= 12 and _tahun_wajar(m.group(3), sekarang):
            return m.group(0)
    for m in _TGL_KATA.finditer(teks):
        if 1 <= int(m.group(1)) <= 31 and _tahun_wajar(m.group(2), sekarang):
            return m.group(0)
    return None


# Label wajib berdiri sebagai kata (\b di depan, bukan-huruf di belakang) — tanpa itu "ref"/"nota" cocok di
# tengah kata lain. Nomor harus di BARIS yang sama ([ \t], bukan \s) supaya
# tak melompat ke baris berikutnya yang isinya lain.
_NOMOR = re.compile(
    r"\b(?:no\.?[ \t]*(?:nota|faktur|invoice|inv|struk|trans(?:aksi)?|bon|ref)?|invoice|faktur|nota|struk|receipt|bon|ref)(?![A-Za-z])"
    r"[ \t]*[:#.]?[ \t]*([A-Z0-9][A-Z0-9\-/.]{4,})",
    re.I,
)


def cari_nomor(teks: str) -> Optional[str]:
    """Nomor dokumen dari baris berlabel (No. Nota / Invoice / Faktur / Struk).
    Token wajib mengandung angka — label tanpa nomor diabaikan."""
    for m in _NOMOR.finditer(teks):
        tok = m.group(1).strip(".-/")
        if re.search(r"\d", tok) and len(tok) >= 5:
            return tok
    return None


# Merek yang sering muncul di reimburse — dicari dulu karena baris pertama
# struk kerap logo yang tak terbaca.
_MEREK = (
    "ALFAMART", "ALFAMIDI", "INDOMARET", "LAWSON", "FAMILYMART", "CIRCLE K",
    "PERTAMINA", "SHELL", "VIVO", "SPBU", "GRAB", "GOJEK", "GO-JEK", "MAXIM", "BLUEBIRD",
    "TOKOPEDIA", "SHOPEE", "LAZADA", "GRAMEDIA", "ACE HARDWARE", "INFORMA", "MITRA10", "DEPO BANGUNAN",
    "HYPERMART", "TRANSMART", "CARREFOUR", "SUPERINDO", "LOTTE MART", "RAMAYANA",
    "KIMIA FARMA", "APOTEK K-24", "GUARDIAN", "WATSONS", "TRAVELOKA", "TIKET.COM",
)


def cari_pihak(teks: str) -> Optional[str]:
    """Nama toko/institusi: baris yang memuat merek dikenal, kalau tidak ada
    baris awal yang dominan huruf (bukan alamat/NPWP/telepon)."""
    baris = [b.strip() for b in teks.splitlines() if b.strip()]
    for b in baris[:15]:
        up = b.upper()
        for merek in _MEREK:
            i = up.find(merek)
            if i >= 0:
                bersih = re.sub(r"\s{2,}", " ", b[i:]).split("/")[0].strip(" -—:|")
                return bersih[:80]
    for b in baris[:6]:
        huruf = sum(c.isalpha() for c in b)
        if huruf >= 4 and huruf / max(len(b.replace(" ", "")), 1) >= 0.7 and not re.search(
            r"\b(jl|jalan|npwp|telp|tel|hp|wa|kasir|alamat)\b", b, re.I
        ):
            return re.sub(r"\s{2,}", " ", b).strip(" -—:|")[:80]
    return None


def ekstrak_klaim(teks_per_psm: List[str]) -> dict:
    """Gabungkan teks semua mode lalu cari tiap field. raw_text = mode pertama."""
    gabung = "\n".join(teks_per_psm)
    return {
        "raw_text": (teks_per_psm[0] if teks_per_psm else "").strip(),
        "nomor_dokumen": cari_nomor(gabung),
        "tanggal_dokumen": cari_tanggal(gabung),
        "nominal": cari_nominal(gabung),
        "pihak": cari_pihak(gabung),
    }
