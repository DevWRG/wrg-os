"""Aduan GA (Helpdesk F139) — pilah pesan grup WA "Aduan GA" jadi aksi tiket.

apps/api (repo/ga-aduan-wa.ts) mengirim sekumpulan pesan baru berurutan waktu,
beberapa pesan sebelumnya sebagai konteks, dan daftar tiket yang masih terbuka.
LLM memutus tiap pesan baru: aduan baru, progres, selesai, komentar, atau
abaikan. Penerapan ke DB (status tiket, timeline) tetap di apps/api — modul ini
hanya membangun prompt dan memvalidasi keluaran LLM.
"""

import json
from typing import Any, Dict, List, Optional

JENIS = ("aduan_baru", "progres", "selesai", "komentar", "abaikan")
PRIORITAS = ("low", "medium", "high", "critical")


def build_aduan_system(kategori: List[str]) -> str:
    daftar_kategori = ", ".join(kategori) or "UMUM"
    return (
        "Kamu pencatat Helpdesk GA (General Affair) sebuah perusahaan distributor alat kesehatan. "
        "Kamu membaca pesan grup WhatsApp \"Aduan GA\", tempat karyawan melapor kendala kantor "
        "(lampu mati, AC/cold storage bermasalah, printer rusak, jaringan, dsb.) atau minta tolong "
        "staf GA (antar dokumen ke bank, ambil barang, dsb.). Staf GA membalas di grup yang sama.\n\n"
        "Tiap pesan diberi tanda [GA] bila pengirimnya staf GA, [PELAPOR] bila bukan.\n\n"
        "Putuskan SATU jenis untuk SETIAP pesan BARU (jangan untuk pesan KONTEKS):\n"
        "- aduan_baru: laporan kendala atau permintaan tolong yang BELUM tercatat di daftar tiket "
        "terbuka maupun di pesan baru sebelumnya. Permintaan rutin yang diulang di hari lain "
        "(mis. \"hari ini minta tolong ke bank\" lagi) = aduan_baru tersendiri.\n"
        "- progres: balasan [GA] yang menyanggupi, sedang/akan mengerjakan, menunggu vendor/dana, "
        "atau memberi kabar perkembangan (\"ya mbak\", \"tak sampaikan ke vendor\", \"teknisi OTW\").\n"
        "- selesai: balasan [GA] yang menyatakan pekerjaan SUDAH beres (\"sudah diganti\", "
        "\"sudah dicuci\", \"diterima satpam\"), ATAU pelapor mengonfirmasi masalahnya sudah teratasi "
        "(\"wah iya nyala, terima kasih\"). Ucapan terima kasih atas JANJI yang belum dikerjakan "
        "(\"makasih mas\" sesudah \"nanti saya ganti\") BUKAN selesai — itu abaikan.\n"
        "- komentar: tambahan info atau tagihan kabar dari pelapor tentang tiket yang sudah ada "
        "(\"sudah ada update?\", \"dijadwalkan dulu saja\").\n"
        "- abaikan: obrolan basa-basi, salam, \"oke\"/\"iya\" dari pelapor, pesan tanpa isi.\n\n"
        "Untuk progres/selesai/komentar, isi \"tiket\" dengan nomor tiket terbuka (TKT-...) ATAU ref "
        "pesan aduan_baru di kumpulan yang sama (mis. \"M2\"). Cocokkan lewat isi dan urutan: balasan "
        "GA biasanya menjawab aduan terakhir yang belum dijawab, atau menyebut barang/tempat yang sama. "
        "Kalau tidak yakin tiket mana, isi tiket=null dan beri yakin rendah.\n\n"
        "Untuk aduan_baru isi: judul (≤80 karakter, bahasa Indonesia ringkas, sebut barang & tempat), "
        f"kategori (salah satu: {daftar_kategori}; permintaan tolong/tugas = PERMINTAAN, "
        "perangkat komputer/printer/jaringan = IT bila ada), lokasi (null kalau tak disebut), "
        "prioritas (low|medium|high|critical; critical hanya bila mengancam barang/pasien, mis. "
        "cold storage mati).\n\n"
        "Kembalikan JSON SAJA (tanpa markdown):\n"
        '{"aksi": [{"ref": "M1", "jenis": "aduan_baru|progres|selesai|komentar|abaikan", '
        '"tiket": "TKT-2026-00012" | "M1" | null, "judul": str|null, "kategori": str|null, '
        '"lokasi": str|null, "prioritas": str|null, "yakin": 0.0-1.0}]}\n'
        "Satu objek per pesan BARU, urut sesuai ref."
    )


def _baris_pesan(p: Dict[str, Any]) -> str:
    tanda = "[GA]" if p.get("staf_ga") else "[PELAPOR]"
    isi = " ".join(str(p.get("isi") or "").split())
    return f"{p.get('ref', '-')} | {p.get('waktu', '')} | {tanda} {p.get('pengirim') or '?'}: {isi}"


def build_aduan_user(pesan: List[Dict[str, Any]], konteks: List[Dict[str, Any]], tiket: List[Dict[str, Any]]) -> str:
    bagian = []
    if tiket:
        baris = [
            f"{t.get('no')} | {t.get('status')} | dibuka {t.get('dibuka')} oleh {t.get('pelapor') or '?'} | {t.get('judul')}"
            for t in tiket
        ]
        bagian.append("TIKET TERBUKA:\n" + "\n".join(baris))
    else:
        bagian.append("TIKET TERBUKA: (tidak ada)")
    if konteks:
        bagian.append("PESAN KONTEKS (sudah diproses, jangan diputus):\n" + "\n".join(_baris_pesan(p) for p in konteks))
    bagian.append("PESAN BARU:\n" + "\n".join(_baris_pesan(p) for p in pesan))
    return "\n\n".join(bagian)


def _bersihkan_json(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(ln for ln in cleaned.splitlines() if not ln.strip().startswith("```")).strip()
    if cleaned.lower().startswith("json"):
        cleaned = cleaned[4:].strip()
    return cleaned


def _teks(v: Any, maks: int) -> Optional[str]:
    if v is None:
        return None
    s = " ".join(str(v).split())
    return s[:maks] if s else None


def parse_aduan(text: str, refs: List[str], kategori: List[str]) -> Optional[List[Dict[str, Any]]]:
    """Validasi keluaran LLM. None = JSON rusak (pemanggil anggap gagal, coba lagi).

    Ref yang tak dikenal dibuang; ref yang tak diputus LLM TIDAK diisi di sini —
    apps/api membiarkannya untuk dipindai ulang.
    """
    try:
        d = json.loads(_bersihkan_json(text))
    except (ValueError, TypeError):
        return None
    daftar = d.get("aksi") if isinstance(d, dict) else d
    if not isinstance(daftar, list):
        return None
    kenal = set(refs)
    kat = {k.upper() for k in kategori}
    hasil: List[Dict[str, Any]] = []
    sudah = set()
    for a in daftar:
        if not isinstance(a, dict):
            continue
        ref = str(a.get("ref") or "")
        if ref not in kenal or ref in sudah:
            continue
        jenis = str(a.get("jenis") or "").lower()
        if jenis not in JENIS:
            continue
        sudah.add(ref)
        k = str(a.get("kategori") or "").upper() or None
        p = str(a.get("prioritas") or "").lower() or None
        try:
            yakin = float(a.get("yakin") if a.get("yakin") is not None else 0.0)
        except (TypeError, ValueError):
            yakin = 0.0
        hasil.append({
            "ref": ref,
            "jenis": jenis,
            "tiket": _teks(a.get("tiket"), 40),
            "judul": _teks(a.get("judul"), 120),
            "kategori": k if k in kat else None,
            "lokasi": _teks(a.get("lokasi"), 120),
            "prioritas": p if p in PRIORITAS else None,
            "yakin": max(0.0, min(1.0, yakin)),
        })
    return hasil
