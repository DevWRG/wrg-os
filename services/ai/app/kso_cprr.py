import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Dict, List, Optional, Tuple

def tesseract_cmd() -> Optional[str]:
    """Lokasi binary tesseract. pm2 di Mac mini tak selalu membawa
    /opt/homebrew/bin di PATH, jadi lokasi Homebrew dicoba eksplisit.
    Salinan dari app/klaim.py (dev) — main belum memuat #KLAIM OCR."""
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


# F170 Komite KSO — baca lampiran PDF "KSO CPRR — <KATEGORI>" hasil cetak
# Simulator KSO (apps/web/src/lib/kso/print-pdf.ts) TANPA LLM: PDF dirender
# jadi gambar, dibaca Tesseract lokal, lalu field dicari dengan pola label.
#
# Kenapa OCR, bukan ekstraksi teks PDF: PDF ini dicetak browser (Print → Save
# as PDF) dan bisa juga berupa hasil scan/foto ulang — lapisan teksnya tak bisa
# diandalkan. Jalur gambar sama untuk semua asal dokumen.
#
# Render (diuji 10 Nov 2026 pada cetakan asli di Mac mini, tesseract 5.5;
# semua varian di bawah menghasilkan isian yang sama lewat parser ini):
#   - pypdfium2 300 dpi RGB = jalur utama. Lintas-platform, merender semua
#     halaman, dan satu-satunya yang membaca "Tanggal: ..." (teks putih di
#     header biru). Kuirknya: "5%" di baris Margin terbaca "596" dan "QC" jadi
#     "OC" — keduanya ditangani parser (persen() + label "Markup N%").
#   - pypdfium2 300 dpi GRAYSCALE = lintasan kedua, HANYA untuk mengisi field
#     yang masih kosong. Grayscale membaca "5%"/"QC" bersih, tapi kehilangan
#     teks putih di header.
#   - qlmanage (macOS) = cadangan kalau pypdfium2 tak terpasang di venv
#     (deploy-prod.sh tidak menjalankan pip install). Hanya halaman 1, dan
#     ikut kehilangan tanggal di header.
#   - sips TIDAK dipakai: render 72 dpi, "Z50" terbaca "250", "700" → "TOO".
# Tesseract membaca PNG dari stdin, jadi tak ada berkas sementara untuk
# Tesseract (TCC macOS memblokir sebagian daemon membaca /tmp).

_DPI = 300
_MAX_HALAMAN = 2
_BATAS_WAKTU_S = 60
_MAX_TEKS = 8000

KATEGORI = (
    "HEMATOLOGI",
    "KIMIA KLINIK",
    "CLIA",
    "CROSSMATCH",
    "HPLC",
    "ELEKTROLIT",
    "BLOOD GAS",
)


class GalatCprr(Exception):
    """Galat yang sudah punya kode untuk respons (`galat`)."""

    def __init__(self, kode: str, detail: str = ""):
        super().__init__(f"{kode}: {detail}" if detail else kode)
        self.kode = kode


# ── Render ──────────────────────────────────────────────────────────────────


def jumlah_halaman(pdf_bytes: bytes) -> int:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return 1 if pdf_bytes.startswith(b"%PDF") else 0
    try:
        return len(pdfium.PdfDocument(pdf_bytes))
    except Exception as e:  # noqa: BLE001
        raise GalatCprr("pdf-rusak", str(e)[:200])


def render_pdfium(pdf_bytes: bytes, grayscale: bool, max_pages: int = _MAX_HALAMAN) -> List[bytes]:
    """PDF → PNG per halaman pada 300 dpi. ImportError diteruskan ke pemanggil
    (tanda untuk pindah ke qlmanage); PDF rusak → GalatCprr("pdf-rusak")."""
    import pypdfium2 as pdfium

    from .koran import _png_bytes

    try:
        doc = pdfium.PdfDocument(pdf_bytes)
        out: List[bytes] = []
        for i in range(min(len(doc), max_pages)):
            bitmap = doc[i].render(scale=_DPI / 72, rev_byteorder=True, grayscale=grayscale)
            out.append(_png_bytes(bitmap.buffer, bitmap.width, bitmap.height, bitmap.stride, bitmap.mode))
        return out
    except Exception as e:  # noqa: BLE001
        raise GalatCprr("pdf-rusak", str(e)[:200])


def render_qlmanage(pdf_bytes: bytes, timeout: float) -> List[bytes]:
    """Cadangan macOS: Quick Look merender halaman 1 jadi PNG 2600 px
    (setara ~300 dpi A4). Direktori sementara bisa diarahkan lewat
    KSO_OCR_TMPDIR; selalu dihapus setelah dipakai."""
    ql = shutil.which("qlmanage") or ("/usr/bin/qlmanage" if os.path.exists("/usr/bin/qlmanage") else None)
    if sys.platform != "darwin" or not ql:
        raise GalatCprr("render-tidak-tersedia", "pypdfium2 tak terpasang dan qlmanage tak ada")
    tmp = tempfile.mkdtemp(prefix="kso-cprr-", dir=os.environ.get("KSO_OCR_TMPDIR") or None)
    try:
        pdf = os.path.join(tmp, "cprr.pdf")
        with open(pdf, "wb") as f:
            f.write(pdf_bytes)
        subprocess.run(
            [ql, "-t", "-s", "2600", "-o", tmp, pdf],
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        png = pdf + ".png"
        if not os.path.exists(png):
            raise GalatCprr("pdf-rusak", "qlmanage tak menghasilkan gambar")
        with open(png, "rb") as f:
            return [f.read()]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ocr_png(cmd: str, png: bytes, timeout: float) -> str:
    """Tesseract psm 4 (satu kolom teks ukuran beragam) — mode yang membaca
    cetakan CPRR paling bersih. preserve_interword_spaces mempertahankan celah
    lebar antar-kolom header (dipakai pemisah NAMA SALES / FASKES / KOTA)."""
    out = subprocess.run(
        [cmd, "stdin", "stdout", "-l", "ind+eng", "--psm", "4", "-c", "preserve_interword_spaces=1"],
        input=png,
        capture_output=True,
        timeout=max(1.0, timeout),
        check=False,
    )
    if out.returncode != 0:
        raise RuntimeError(f"tesseract gagal: {out.stderr.decode(errors='replace')[:200]}")
    return out.stdout.decode("utf-8", errors="replace")


# ── Angka (pure) ────────────────────────────────────────────────────────────

# Separator ribuan Indonesia = "."; OCR kadang membacanya ":" / ";" / ",".
_ANGKA = re.compile(r"\d{1,3}(?:[.,:;]\d{3})+(?!\d)|\d+")
_KOSONG = re.compile(r"^[\s—–\-|_.]*$")


def _rapikan_angka(s: str) -> str:
    # Huruf O/o yang MENEMPEL di belakang digit = nol: "7O0" → "700",
    # "3O bulan" → "30", "4.0O0" → "4.000". Hanya dipakai pada sel angka.
    # O tanpa digit di depannya dibiarkan: "TOO" terlalu ambigu ditebak.
    return re.sub(r"(?<=\d)[Oo]+(?=[\d.,:;\s%]|$)", lambda m: "0" * len(m.group(0)), s)


def angka(s: Optional[str]) -> Optional[int]:
    """Bilangan bulat pertama dalam s. "Rp 48.000.000" → 48000000,
    "25.200 test" → 25200, "Rp o" / "Rp0" → 0, "—" → None."""
    if s is None or _KOSONG.match(s):
        return None
    s = _rapikan_angka(s)
    # "Rp o" / "Rp O" (OCR "Rp 0") tanpa digit lain.
    if re.match(r"^\W*rp\.?\s*[oO0]\b", s.strip(), re.I) and not re.search(r"\d[.,:;]?\d", s):
        return 0
    m = _ANGKA.search(s)
    if not m:
        return None
    return int(re.sub(r"[.,:;]", "", m.group(0)))


def persen(s: Optional[str]) -> Optional[float]:
    """"5%" → 5.0, "7,5 %" → 7.5. Tesseract kadang membaca "%" jadi "96"
    ("5%" → "596"); angka > 100 berakhiran 96 tanpa tanda % dipotong."""
    if s is None or _KOSONG.match(s):
        return None
    s = _rapikan_angka(s)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*%", s)
    if m:
        return float(m.group(1).replace(",", "."))
    m = re.search(r"\d+(?:[.,]\d+)?", s)
    if not m:
        return None
    raw = m.group(0)
    if re.fullmatch(r"\d+96", raw) and float(raw) > 100:
        return float(raw[:-2])
    v = float(raw.replace(",", "."))
    return v if v <= 100 else None


# ── Label → field (pure) ────────────────────────────────────────────────────

# Urutan penting: label yang lebih panjang/spesifik didahulukan karena regex
# alternation memilih alternatif pertama yang cocok di posisi paling kiri.
_LABEL: List[Tuple[str, str]] = [
    ("analyzer", r"nama\s+analy[sz]er"),
    ("backup", r"backup\s+analy[sz]er"),
    ("capex_total", r"total\s+capex"),
    ("sub_capex", r"(?:harga\s+alat|ups|lis|backup)\b"),
    ("masa_bulan", r"masa\s+kso"),
    ("total_target_test", r"total\s+target\s+test(?:\s+kso)?"),
    ("hari_kerja", r"hari\s+kerja\s*/\s*bulan"),
    ("margin", r"margin\s*/\s*markup"),
    ("qc_status", r"[qo0]c\s*&\s*kalibrator|kontrol\s*&\s*kalibrator"),
    ("capex_per_test", r"capex\s*/\s*test"),
    ("qc_per_test", r"[qo0]c\s*\+\s*kalibrasi\s*/\s*test|[qo0]c(?:\s+control)?\s*/\s*test"),
    ("kalibrasi_per_test", r"kalibrasi\s*/\s*test"),
    ("base_cost_per_test", r"base\s+cost(?:\s+rata-?\s*rata)?\s*/\s*test"),
    (
        "reagen_per_test",
        r"(?:rata-?\s*rata\s+)?reagen(?:\s*\+\s*part)?\s*/\s*test|hpp\s+cartridge\s*/\s*test(?:\s*\(kit\s+penuh\))?",
    ),
    ("consumable", r"(?:total\s+)?consumable\s*/\s*test(?:\s*\(parameter\s+infeksius\))?"),
    (
        "cprr_per_test",
        r"(?:cprr|running\s+cost)(?:\s+rata-?\s*rata)?\s*[(\[{]?\s*harga\s+jual\s*/\s*test\s*[)\]}]?",
    ),
    ("markup_cprr", r"markup\s+\d+(?:[.,]\d+)?\s*(?:%|96)?"),
    ("test_per_bulan", r"(?:test|sampel)\s*/\s*bulan"),
    ("kompetitor", r"informasi\s+kompetitor"),
]
_POLA_LABEL = re.compile(
    "|".join(f"(?P<{k}>(?<![a-z]){p})" for k, p in _LABEL),
    re.I,
)


def pasangan_label(teks: str) -> Dict[str, str]:
    """Kumpulkan {field: teks nilai mentah}. Nilai = teks sesudah label sampai
    label berikutnya di baris yang sama (cetakan lama memakai grid dua
    kolom: dua pasangan label-nilai per baris) atau akhir baris. Kemunculan
    pertama menang."""
    hasil: Dict[str, str] = {}
    for baris in teks.splitlines():
        cocok = list(_POLA_LABEL.finditer(baris))
        for i, m in enumerate(cocok):
            kunci = m.lastgroup or ""
            # Teks kompetitor bebas (bisa memuat "LIS", "QC", ...) → sisa baris utuh.
            akhir_baris = kunci == "kompetitor" or i + 1 >= len(cocok)
            ujung = len(baris) if akhir_baris else cocok[i + 1].start()
            nilai = baris[m.end():ujung].strip(" \t|:")
            if kunci == "markup_cprr":
                # Persentase ada DI label ("Markup 5%"); nilainya = rupiah markup.
                hasil.setdefault("markup_label", m.group(0))
            if kunci and kunci not in hasil:
                hasil[kunci] = nilai
            if kunci == "kompetitor":
                break
    return hasil


# ── Header ──────────────────────────────────────────────────────────────────

_LABEL_HEADER = re.compile(r"nama\s+sales.*nama\s+faskes.*kota", re.I)


def _kolom_label(baris: str) -> List[int]:
    pos = []
    for p in (r"nama\s+sales", r"nama\s+faskes", r"kota"):
        m = re.search(p, baris, re.I)
        pos.append(m.start() if m else -1)
    return pos


def _bersih_nilai(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip(" |—–-")
    return s or None


def pecah_header(teks: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], bool]:
    """Baris label "NAMA SALES  NAMA FASKES  KOTA / KAB" dicetak sebaris, nilai
    ketiganya di baris berikutnya. Kembalikan (sales, faskes, kota, mentah, pasti).

    1. Tesseract (preserve_interword_spaces) mempertahankan celah lebar antar
       kolom → pecah di 2+ spasi. Tepat 3 potong = pasti.
    2. Potongan ≠ 3 → tiap potong ditaruh ke kolom label yang posisi
       karakternya paling dekat (kolom kosong "—" juga tertangani).
    3. Teks satu spasi (tanpa celah) → TEBAKAN: sales = kata pertama,
       kota = kata terakhir, faskes = sisanya. Salah untuk nama sales dua kata
       atau kota dua kata ("KAB. X") → pasti=False; pemanggil (apps/api)
       wajib mencocokkan longgar dengan data form, bukan menelan mentah."""
    baris = teks.splitlines()
    for i, b in enumerate(baris):
        if not _LABEL_HEADER.search(b):
            continue
        nilai = next((x for x in baris[i + 1:] if x.strip()), None)
        if nilai is None:
            return None, None, None, None, False
        mentah = re.sub(r"\s+", " ", nilai).strip()
        potong = [(m.start(), m.group(0)) for m in re.finditer(r"\S+(?: \S+)*", nilai)]
        if len(potong) == 3:
            s, f, k = (_bersih_nilai(p[1]) for p in potong)
            return s, f, k, mentah, True
        kolom = _kolom_label(b)
        if len(potong) > 1 and all(c >= 0 for c in kolom):
            isi: List[List[str]] = [[], [], []]
            for pos, t in potong:
                idx = min(range(3), key=lambda j: abs(kolom[j] - pos))
                isi[idx].append(t)
            s, f, k = (_bersih_nilai(" ".join(x)) if x else None for x in isi)
            return s, f, k, mentah, False
        kata = mentah.split(" ")
        if len(kata) >= 3:
            return kata[0], " ".join(kata[1:-1]), kata[-1], mentah, False
        return None, None, None, mentah or None, False
    return None, None, None, None, False


# ── Ekstraksi lengkap (pure — diuji di tests/test_kso_cprr.py) ──────────────

_JUDUL = re.compile(
    r"KSO\s+(CPRR|RUNNING\s+COST)\s*[—–\-]+\s*(" + "|".join(k.replace(" ", r"\s+") for k in KATEGORI) + r")\b",
    re.I,
)
_TANGGAL = re.compile(r"tanggal\s*[:;.]?\s*(\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{4})", re.I)

FIELD_ISIAN = (
    "judul", "tanggal", "nama_sales", "nama_faskes", "kota", "analyzer",
    "capex_total", "masa_bulan", "test_per_bulan", "total_target_test",
    "hari_kerja", "markup_persen", "capex_per_test", "reagen_per_test",
    "qc_per_test", "base_cost_per_test", "cprr_per_test", "kompetitor_teks",
)


def isian_kosong() -> dict:
    d: dict = {k: None for k in FIELD_ISIAN}
    d["header_mentah"] = None
    d["header_pasti"] = False
    return d


def adalah_cprr(teks: str) -> bool:
    return bool(re.search(r"cprr|running\s+cost", teks or "", re.I))


def ekstrak_cprr(teks: str) -> dict:
    """Teks OCR → isian. Field yang tak ditemukan = None, bukan tebakan
    (kecuali pemisahan header, lihat pecah_header)."""
    d = isian_kosong()
    if not teks:
        return d
    m = _JUDUL.search(teks)
    if m:
        jenis = re.sub(r"\s+", " ", m.group(1)).upper()
        kategori = re.sub(r"\s+", " ", m.group(2)).upper()
        d["judul"] = f"KSO {jenis} — {kategori}"
    m = _TANGGAL.search(teks)
    if m:
        d["tanggal"] = re.sub(r"\s+", "", m.group(1))

    sales, faskes, kota, mentah, pasti = pecah_header(teks)
    d.update(nama_sales=sales, nama_faskes=faskes, kota=kota, header_mentah=mentah, header_pasti=pasti)

    p = pasangan_label(teks)
    d["analyzer"] = _bersih_nilai(p.get("analyzer"))
    for k in ("capex_total", "masa_bulan", "test_per_bulan", "total_target_test", "hari_kerja",
              "capex_per_test", "reagen_per_test", "base_cost_per_test", "cprr_per_test"):
        d[k] = angka(p.get(k))
    qc = angka(p.get("qc_per_test"))
    kal = angka(p.get("kalibrasi_per_test"))
    # Kimia Klinik mencetak QC control & kalibrasi terpisah — dijumlah supaya
    # setara "QC + kalibrasi / test" kategori lain.
    d["qc_per_test"] = qc + kal if qc is not None and kal is not None else (qc if qc is not None else kal)

    # Persen markup: baris "Margin / markup" lalu label "Markup N%" di blok CPRR.
    # Yang memakai tanda % eksplisit didahulukan (lihat persen() soal "596").
    calon = [p.get("margin"), p.get("markup_label")]
    tegas = [persen(c) for c in calon if c and "%" in c]
    d["markup_persen"] = next((v for v in tegas if v is not None), None)
    if d["markup_persen"] is None:
        d["markup_persen"] = next((v for v in (persen(c) for c in calon) if v is not None), None)

    kompetitor = _bersih_nilai(p.get("kompetitor"))
    d["kompetitor_teks"] = kompetitor
    return d


def periksa(d: dict) -> List[str]:
    """Cek silang angka yang saling bergantung — penanda salah baca OCR, bukan
    penolak. Toleransi longgar karena tiap angka dibulatkan saat dicetak."""
    out: List[str] = []
    cap, tot, cpt = d.get("capex_total"), d.get("total_target_test"), d.get("capex_per_test")
    if cap and tot and cpt is not None and abs(cap / tot - cpt) > max(2, cpt * 0.01):
        out.append("capex_per_test tak sama dengan capex_total / total_target_test")
    tpb, masa = d.get("test_per_bulan"), d.get("masa_bulan")
    if tpb and masa and tot and tpb * masa != tot:
        out.append("total_target_test tak sama dengan test_per_bulan × masa_bulan")
    base, cprr = d.get("base_cost_per_test"), d.get("cprr_per_test")
    if base is not None and cprr is not None and cprr < base:
        out.append("cprr_per_test lebih kecil dari base_cost_per_test")
    return out


def _gabung(utama: dict, cadangan: dict) -> dict:
    hasil = dict(utama)
    for k in FIELD_ISIAN:
        if hasil.get(k) is None and cadangan.get(k) is not None:
            hasil[k] = cadangan[k]
    if not hasil.get("header_pasti") and cadangan.get("header_pasti"):
        for k in ("nama_sales", "nama_faskes", "kota", "header_mentah", "header_pasti"):
            hasil[k] = cadangan[k]
    return hasil


# ── Jalur penuh (dipanggil endpoint) ────────────────────────────────────────


def baca_cprr(pdf_bytes: bytes) -> dict:
    """PDF → {halaman, teks_ocr, isian, peringatan}. Raise GalatCprr."""
    if not pdf_bytes or not pdf_bytes.lstrip()[:5].startswith(b"%PDF"):
        raise GalatCprr("pdf-rusak", "bukan berkas PDF")
    cmd = tesseract_cmd()
    if not cmd:
        raise GalatCprr("ocr-tidak-tersedia", "binary tesseract tidak ditemukan (set TESSERACT_CMD)")
    mulai = time.monotonic()

    def sisa() -> float:
        s = _BATAS_WAKTU_S - (time.monotonic() - mulai)
        if s <= 1:
            raise GalatCprr("ocr-timeout", "melebihi batas waktu")
        return s

    halaman = jumlah_halaman(pdf_bytes)
    try:
        gambar = render_pdfium(pdf_bytes, grayscale=False)
        pakai_pdfium = True
    except ImportError:
        gambar = render_qlmanage(pdf_bytes, timeout=sisa())
        pakai_pdfium = False
    if not gambar:
        raise GalatCprr("pdf-rusak", "PDF tanpa halaman")

    try:
        teks = "\n".join(ocr_png(cmd, g, sisa()) for g in gambar)
    except subprocess.TimeoutExpired:
        raise GalatCprr("ocr-timeout", "tesseract melebihi batas waktu")
    except (OSError, RuntimeError) as e:
        raise GalatCprr("ocr-gagal", str(e)[:200])

    isian = ekstrak_cprr(teks)
    # Lintasan kedua (grayscale halaman 1) hanya kalau ada field kosong.
    if pakai_pdfium and adalah_cprr(teks) and any(isian.get(k) is None for k in FIELD_ISIAN):
        try:
            abu = render_pdfium(pdf_bytes, grayscale=True, max_pages=1)
            isian = _gabung(isian, ekstrak_cprr(ocr_png(cmd, abu[0], sisa())))
        except (GalatCprr, subprocess.TimeoutExpired, OSError, RuntimeError) as e:
            print(f"[kso/ocr-cprr] lintasan grayscale dilewati: {e}", flush=True)

    return {
        "halaman": halaman or len(gambar),
        "teks_ocr": teks.strip()[:_MAX_TEKS],
        "isian": isian,
        "peringatan": periksa(isian),
    }
