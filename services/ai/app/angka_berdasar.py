"""Pemeriksa angka tak berdasar di narasi briefing (F63 & briefing weekend).

Aturan user 11 Nov 2026: narasi AI tidak boleh memuat angka apa pun yang tidak
ada datanya — termasuk anggaran, insentif, target, atau proyeksi karangan.
Prompt sudah melarangnya, tapi uji W35 tetap memuat "insentif Rp 25 jt" dan
"budget Rp 50-100 jt" yang tak ada di rekap. Jadi sesudah LLM menjawab, setiap
angka bermakna (Rupiah, persen, jumlah bersatuan) dicocokkan dengan bahan
masukan; yang tak bersumber diganti penanda, bukan dibuang — supaya tabel dan
struktur bagian A–H tetap utuh.

Murni (tanpa LLM) dan diuji di tests/test_angka_berdasar.py.
"""

import re
from typing import Iterable, List, Set, Tuple

PENANDA = "(angka belum ada datanya)"

_SKALA = {
    "rb": 1e3, "ribu": 1e3, "k": 1e3,
    "j": 1e6, "jt": 1e6, "juta": 1e6,
    "m": 1e9, "miliar": 1e9, "milyar": 1e9, "b": 1e9,
}

_ANGKA = r"\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?"
_SATUAN_HITUNG = (
    "customer|pelanggan|akun|faskes|site|deal|order|unit|tes|box|kit|sku|item|rs|cabang|am|orang|"
    "institusi|shipment|pengiriman|kunjungan|hari|minggu|bulan|jam|dokumen|faktur|po|so|sj|teknisi|alat"
)

# Rupiah: "Rp 25 jt", "Rp25juta", "Rp 1,2 M", "Rp 4-8juta" (rentang: tiap ujung diperiksa).
_POLA_RP = re.compile(
    rf"Rp\.?\s?(?P<a>{_ANGKA})(?:\s?[-–]\s?(?P<b>{_ANGKA}))?\s?(?P<s>rb|ribu|k|jt|juta|j|m|miliar|milyar|b)?\b",
    re.IGNORECASE,
)
# Tanpa "Rp" tapi berskala uang: "50-100jt", "2 juta", "1,5 miliar".
_POLA_SKALA = re.compile(
    rf"(?<![\w.,])(?P<a>{_ANGKA})(?:\s?[-–]\s?(?P<b>{_ANGKA}))?\s?(?P<s>jt|juta|miliar|milyar)\b",
    re.IGNORECASE,
)
_POLA_PERSEN = re.compile(rf"(?<![\w.,])[+-]?(?P<a>{_ANGKA})\s?%")
_POLA_HITUNG = re.compile(rf"(?<![\w.,/:-])(?P<a>\d{{2,}})\s+(?:{_SATUAN_HITUNG})\b", re.IGNORECASE)


def _ke_float(teks: str) -> float:
    t = teks.strip()
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", t):  # 1.250.000,5
        t = t.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", t):  # 1,250,000.5
        t = t.replace(",", "")
    else:
        t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return float("nan")


def _nilai_rp(m: re.Match) -> List[float]:
    skala = _SKALA.get((m.group("s") or "").lower(), 1.0)
    out = [_ke_float(m.group("a")) * skala]
    if m.group("b"):
        out.append(_ke_float(m.group("b")) * skala)
    return out


def sebutan_angka(teks: str) -> List[Tuple[str, str, List[float]]]:
    """(teks asli, jenis, nilai) untuk tiap angka bermakna. Jenis: rp | persen | hitung."""
    out: List[Tuple[str, str, List[float]]] = []
    terpakai: List[Tuple[int, int]] = []

    def bebas(a: int, b: int) -> bool:
        return all(b <= x or a >= y for x, y in terpakai)

    for pola, jenis in ((_POLA_RP, "rp"), (_POLA_SKALA, "rp"), (_POLA_PERSEN, "persen"), (_POLA_HITUNG, "hitung")):
        for m in pola.finditer(teks or ""):
            if not bebas(m.start(), m.end()):
                continue
            if jenis == "rp":
                nilai = _nilai_rp(m)
            else:
                nilai = [_ke_float(m.group("a"))]
            terpakai.append((m.start(), m.end()))
            out.append((m.group(0), jenis, nilai))
    return out


def _nilai_sumber(sumber: str) -> Set[float]:
    """Semua nilai yang mungkin dimaksud di bahan: angka mentah + versi berskala uang."""
    nilai: Set[float] = set()
    for _, _, vs in sebutan_angka(sumber):
        nilai.update(vs)
    for m in re.finditer(_ANGKA, sumber or ""):
        v = _ke_float(m.group(0))
        if v == v:  # bukan NaN
            nilai.add(v)
    return nilai


def _cocok(v: float, sumber: Iterable[float], jenis: str) -> bool:
    if v != v:
        return True
    for s in sumber:
        if jenis == "rp":
            # Pembulatan "Rp 968 jt" dari 968.123.273 → toleransi 1%; juga terima angka mentah sama.
            if s and abs(v - s) <= 0.01 * max(abs(v), abs(s)):
                return True
        elif abs(abs(v) - abs(s)) <= (0.5 if jenis == "persen" else 0):
            return True
    return False


def angka_tak_berdasar(narasi: str, sumber: str) -> List[str]:
    """Teks sebutan angka di narasi yang nilainya tak ada di sumber (unik, urut kemunculan)."""
    nilai = _nilai_sumber(sumber)
    temuan: List[str] = []
    for teks, jenis, vs in sebutan_angka(narasi):
        if not all(_cocok(v, nilai, jenis) for v in vs) and teks not in temuan:
            temuan.append(teks)
    return temuan


def ganti_angka_tak_berdasar(narasi: str, sumber: str) -> Tuple[str, List[str]]:
    """Ganti tiap angka tak bersumber dengan PENANDA. Kembalikan (narasi baru, daftar yang diganti)."""
    temuan = angka_tak_berdasar(narasi, sumber)
    hasil = narasi
    for t in sorted(temuan, key=len, reverse=True):
        hasil = re.sub(rf"(?<![\w.,]){re.escape(t)}", PENANDA, hasil)
    return hasil, temuan
