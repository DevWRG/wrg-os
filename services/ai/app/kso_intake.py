"""F170 Komite KSO — ekstraksi rencana KSO dari pesan WhatsApp AM (#KSO).

Aturan paket (spesifikasi bab 2.4): AI hanya mengisi kolom yang BENAR-BENAR diucapkan AM.
Prompt saja tidak cukup untuk menjamin itu, jadi hasil model disaring ulang di sini secara
deterministik (`bersihkan`): angka harus bisa dilacak ke teks, nama pendukung dan sumber volume
harus muncul di teks, enum di luar daftar dibuang. Kolom yang gugur = null → bot bertanya.
Pencocokan faskes/alat ke master BUKAN tugas modul ini (dikerjakan API).
"""

import re
from typing import Any, Dict, List, Optional, Set

UNIT_STATUS = ("baru", "eks_kso", "eks_demo", "refurbish", "pinjaman_principal", "idle")
KLAUSUL = ("eksklusivitas", "jaminan_volume", "alat_jatuh", "tanpa_eskalasi", "tanpa_lapor", "tanpa_denda", "draft_rs")
PENDUKUNG_TIPE = ("manajemen", "dokter_user", "kepala_instalasi", "analis_perawat", "pengadaan")
KONTAK_CARA = ("kunjungan", "telepon", "wa", "email")
LEAD_ASAL = ("am", "hod", "direksi", "principal", "asosiasi", "inbound")

# Kata yang harus ada di teks supaya unit_status boleh diisi.
_UNIT_KATA = {
    "baru": r"\bbaru\b",
    "eks_kso": r"\beks[\s-]*kso\b|\bbekas\s+kso\b",
    "eks_demo": r"\beks[\s-]*demo\b|\bbekas\s+demo\b",
    "refurbish": r"\brefurb",
    "pinjaman_principal": r"\bpinjam",
    "idle": r"\bidle\b|\bnganggur",
}

KSO_SYSTEM_PROMPT = """Kamu mengekstrak rencana KSO dari pesan Account Manager PT Wahana Rizky Gumilang (distributor alat laboratorium).
Aturan:
- Isi hanya kolom yang benar-benar diucapkan AM. Kolom lain = null. Jangan menebak, jangan melengkapi, jangan memakai nilai umum.
- volume_sumber: salin kalimat AM apa adanya tentang DARI MANA angka volume berasal, jangan dirapikan atau diterjemahkan ke kategori.
- volume rentang ("800-1000") → volume_estimasi = batas bawah, volume_kalimat_asli = kalimat aslinya.
- tenor dalam tahun → ubah ke bulan (3 tahun = 36).
- harga dalam ribuan ("18,5 rb", "18.500") → angka rupiah penuh (18500).
- faskes_teks dan alat_teks: kembalikan teks yang diucapkan AM. Pencocokan ke master dilakukan sistem, bukan kamu.
- pendukung: satu objek per orang. tipe hanya salah satu dari manajemen, dokter_user, kepala_instalasi, analis_perawat, pengadaan; kalau tidak jelas, null. tanggal kontak format YYYY-MM-DD bila disebut.
- klausul_khusus: hanya kode dari daftar: eksklusivitas, jaminan_volume, alat_jatuh (alat jadi milik RS), tanpa_eskalasi (harga tak boleh naik), tanpa_lapor (RS tak mau lapor jumlah test), tanpa_denda, draft_rs (draft PKS dari RS).
  AM bilang "tidak ada klausul"/"tanpa klausul khusus" → []. AM TIDAK menyinggung klausul sama sekali → null.
- unit_status hanya: baru, eks_kso, eks_demo, refurbish, pinjaman_principal, idle.
- lead_asal hanya: am, hod, direksi, principal, asosiasi, inbound.
- kompetitor_kontrak_habis: YYYY-MM atau YYYY-MM-DD.

Kembalikan JSON SAJA (tanpa markdown), persis kunci berikut:
{"faskes_teks": str|null, "alat_teks": str|null, "jumlah": int|null, "volume_estimasi": int|null,
 "volume_kalimat_asli": str|null, "volume_sumber": str|null, "harga_per_test": number|null,
 "pakai_harga_daftar": bool|null, "tenor_bulan": int|null, "unit_status": str|null,
 "biaya_instalasi": number|null, "klausul_khusus": [str]|null,
 "pendukung": [{"nama": str, "tipe": str|null, "tanggal": str|null, "cara": str|null}],
 "kompetitor_alat": str|null, "kompetitor_kontrak_habis": str|null, "risiko_catatan": str|null,
 "lead_asal": str|null}"""


def _norm(s: str) -> str:
    """Huruf kecil, tanda baca jadi spasi, spasi dirapatkan — untuk cek 'muncul di teks'."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", (s or "").lower())).strip()


def angka_dalam_teks(teks: str) -> Set[float]:
    """Semua nilai angka yang bisa dibaca dari teks, termasuk varian yang wajar diucapkan AM:
    '18.500' / '18,5 rb' / '18rb' / '53,4 jt' / '3 tahun' (→ juga 36) / '800-1000'."""
    hasil: Set[float] = set()
    t = (teks or "").lower()
    for m in re.finditer(r"(\d[\d.,]*)\s*(rb|ribu|k\b|jt|juta|m\b|miliar|thn|tahun|th\b)?", t):
        mentah, satuan = m.group(1).rstrip(".,"), (m.group(2) or "").strip()
        kandidat: List[float] = []
        # '18.500' / '1.000.000' = pemisah ribuan; '18,5' = desimal; '53.4' ambigu → dua-duanya
        if re.fullmatch(r"\d{1,3}(\.\d{3})+", mentah):
            kandidat.append(float(mentah.replace(".", "")))
        if re.fullmatch(r"\d{1,3}(,\d{3})+", mentah):
            kandidat.append(float(mentah.replace(",", "")))
        try:
            kandidat.append(float(mentah.replace(",", ".")))
        except ValueError:
            pass
        for k in kandidat:
            hasil.add(k)
            if satuan in ("rb", "ribu", "k"):
                hasil.add(round(k * 1_000, 2))
            elif satuan in ("jt", "juta"):
                hasil.add(round(k * 1_000_000, 2))
            elif satuan in ("m", "miliar"):
                hasil.add(round(k * 1_000_000_000, 2))
            elif satuan in ("thn", "tahun", "th"):
                hasil.add(k * 12)
    return hasil


def _angka(v: Any, teks_angka: Set[float], bulat: bool = False) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x < 0 or x not in teks_angka:
        return None  # tak bisa dilacak ke ucapan AM → dianggap tidak diucapkan
    return int(x) if bulat else x


def _teks_ada(v: Any, teks_norm: str) -> Optional[str]:
    if not isinstance(v, str) or not v.strip():
        return None
    return v.strip() if _norm(v) and _norm(v) in teks_norm else None


def _tanggal(v: Any, teks_angka: Set[float]) -> Optional[str]:
    if not isinstance(v, str):
        return None
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", v.strip())
    if not m or float(m.group(1)) not in teks_angka:
        return None  # tahun harus diucapkan
    return f"{m.group(1)}-{m.group(2)}-{m.group(3) or '01'}"


def bersihkan(d: Dict[str, Any], teks: str) -> Dict[str, Any]:
    """Saring hasil LLM terhadap teks asli AM. Tidak pernah menambah nilai, hanya membuang."""
    d = d if isinstance(d, dict) else {}
    tn = _norm(teks)
    ta = angka_dalam_teks(teks)
    tl = (teks or "").lower()

    unit = d.get("unit_status")
    if unit not in UNIT_STATUS or not re.search(_UNIT_KATA[unit], tl):
        unit = None

    klausul = d.get("klausul_khusus")
    if isinstance(klausul, list):
        klausul = [k for k in klausul if k in KLAUSUL]
        if not klausul and not re.search(r"klausul|eksklusi|tanpa\s+syarat|tidak\s+ada\s+(syarat|permintaan)", tl):
            klausul = None  # [] tanpa menyinggung klausul = model mengisi sendiri
    else:
        klausul = None

    pendukung = []
    for p in d.get("pendukung") or []:
        if not isinstance(p, dict):
            continue
        nama = _teks_ada(p.get("nama"), tn)
        if not nama:
            continue
        pendukung.append({
            "nama": nama,
            "tipe": p.get("tipe") if p.get("tipe") in PENDUKUNG_TIPE else None,
            "tanggal": _tanggal(p.get("tanggal"), ta),
            "cara": p.get("cara") if p.get("cara") in KONTAK_CARA else None,
        })

    harga_daftar = d.get("pakai_harga_daftar")
    if harga_daftar is not True or not re.search(r"harga\s+(daftar|standar|list)|pricelist|price\s*list", tl):
        harga_daftar = None

    lead = d.get("lead_asal")
    return {
        "faskes_teks": _teks_ada(d.get("faskes_teks"), tn),
        "alat_teks": _teks_ada(d.get("alat_teks"), tn),
        "jumlah": _angka(d.get("jumlah"), ta, bulat=True),
        "volume_estimasi": _angka(d.get("volume_estimasi"), ta, bulat=True),
        "volume_kalimat_asli": _teks_ada(d.get("volume_kalimat_asli"), tn),
        "volume_sumber": _teks_ada(d.get("volume_sumber"), tn),
        "harga_per_test": _angka(d.get("harga_per_test"), ta),
        "pakai_harga_daftar": harga_daftar,
        "tenor_bulan": _angka(d.get("tenor_bulan"), ta, bulat=True),
        "unit_status": unit,
        "biaya_instalasi": _angka(d.get("biaya_instalasi"), ta),
        "klausul_khusus": klausul,
        "pendukung": pendukung,
        "kompetitor_alat": _teks_ada(d.get("kompetitor_alat"), tn),
        "kompetitor_kontrak_habis": _tanggal(d.get("kompetitor_kontrak_habis"), ta),
        "risiko_catatan": _teks_ada(d.get("risiko_catatan"), tn),
        "lead_asal": lead if lead in LEAD_ASAL and re.search(r"lead|dari\s+(hod|direksi|direktur|principal|asosiasi)|inbound", tl) else None,
    }


def parse_json_llm(text: str) -> Optional[Dict[str, Any]]:
    """Buang pagar ``` / awalan 'json', lalu json.loads. None bila gagal."""
    import json

    c = (text or "").strip()
    if c.startswith("```"):
        c = "\n".join(ln for ln in c.splitlines() if not ln.strip().startswith("```")).strip()
    if c.lower().startswith("json"):
        c = c[4:].strip()
    try:
        d = json.loads(c)
    except (ValueError, TypeError):
        return None
    return d if isinstance(d, dict) else None
