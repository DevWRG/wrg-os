"""F85 Senin Morning Brief — narasi untuk Direktur sebelum rapat HoD.

Status per HoD & Overall Health SUDAH dihitung deterministik oleh apps/api
(repo/senin-brief.ts). LLM hanya menulis narasi di atasnya; ia tidak boleh
mengubah status, dan tidak boleh mengarang angka di luar input.

Format sumber: HOD-Prompt-Workflow.md §4 "Direktur Overview Aggregation"
(Drive, 16 Jun 2026).
"""

from typing import Any, Dict, List

from .executive import NAMA_PERUSAHAAN

SECTIONS = (
    "## Gap Utama per HoD",
    "## Urutan Prioritas Bahasan",
    "## Pertanyaan Kritis Direktur",
    "## Keputusan Direktur Minggu Ini",
)


def build_senin_system(minggu_label: str, periode: str, health: str) -> str:
    return (
        f"Kamu analis kantor Direktur {NAMA_PERUSAHAAN}. Tugasmu menyiapkan bahan "
        f"rapat HoD hari Senin untuk minggu {minggu_label} ({periode}).\n\n"
        "Kamu menerima, per HoD: STATUS kesiapan materi (SIAP / PERLU KLARIFIKASI / "
        "TIDAK SIAP) beserta 5 cek dan alasannya, plus angka WatchPoint minggu itu. "
        f"Overall Health sudah ditetapkan: {health}.\n\n"
        "ATURAN KERAS:\n"
        "1. STATUS & Overall Health adalah keputusan final dari data — JANGAN diubah, "
        "jangan ditulis ulang dengan label lain, jangan dibantah.\n"
        "2. Hanya pakai angka & fakta yang ada di input. Kalau data kosong/N/A, "
        "katakan datanya kosong — jangan menebak nilainya.\n"
        "3. Cek berstatus NA artinya tak berlaku / belum ada sumbernya — jangan "
        "dijadikan gap.\n"
        "4. Kritis, tegas, tanpa basa-basi atau pujian kosong. Bahasa Indonesia.\n"
        "5. Jangan pakai tanda kurung sudut (< >) di mana pun.\n\n"
        "TULIS PERSIS empat bagian markdown ini, berurutan, tanpa judul lain:\n"
        "## Gap Utama per HoD\n"
        "Per HoD: baris '**Nama** — STATUS' lalu maksimal 3 bullet gap paling "
        "penting (dari cek yang gagal + metric merah/memburuk). HoD SIAP cukup 1 "
        "bullet hal yang perlu dijaga.\n"
        "## Urutan Prioritas Bahasan\n"
        "Daftar bernomor SEMUA HoD, urut dari yang paling kritis dibahas; tiap "
        "baris satu alasan singkat.\n"
        "## Pertanyaan Kritis Direktur\n"
        "Per HoD tepat 2 pertanyaan tajam yang Direktur ajukan saat presentasi, "
        "berpijak pada angka/gap di input.\n"
        "## Keputusan Direktur Minggu Ini\n"
        "3–5 keputusan yang perlu Direktur ambil minggu ini: topik, konteks "
        "singkat, usulan."
    )


def _fmt_hod(h: Dict[str, Any]) -> str:
    baris: List[str] = [f"### {h.get('nama')} — {h.get('peran')} · STATUS: {h.get('status')}"]
    for c in h.get("checks") or []:
        baris.append(f"- Cek {c.get('no')} {c.get('label')}: {c.get('hasil')} — {c.get('detail')}")
    metrics = h.get("metrics") or []
    if metrics:
        baris.append(f"WatchPoint (kinerja keseluruhan {h.get('watch_status')}):")
        for m in metrics:
            baris.append(
                f"  • {m.get('label')}: aktual {m.get('actual')} / target {m.get('target')} "
                f"[{m.get('status')}, trend {m.get('trend')}]"
            )
    return "\n".join(baris)


def build_senin_user(hods: List[Dict[str, Any]]) -> str:
    return "DATA PER HOD:\n\n" + "\n\n".join(_fmt_hod(h) for h in hods)


def bersihkan_narasi(text: str) -> str:
    """Buang apa pun sebelum bagian pertama yang diminta (judul/pembuka liar
    dari model) supaya brief tak punya dua judul. Kalau tak satu pun bagian
    ditemukan, kembalikan string kosong — lebih jujur daripada narasi ngawur."""
    t = (text or "").strip()
    idx = [t.find(s) for s in SECTIONS if t.find(s) >= 0]
    if not idx:
        return ""
    return t[min(idx):].strip()
