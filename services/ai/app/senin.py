"""F85 Senin Morning Brief — narasi untuk Direktur sebelum rapat HoD.

Status per HoD & Overall Health SUDAH dihitung deterministik oleh apps/api
(repo/senin-brief.ts). LLM hanya menulis narasi di atasnya; ia tidak boleh
mengubah status, dan tidak boleh mengarang angka di luar input.

Format sumber: HOD-Prompt-Workflow.md §4 "Direktur Overview Aggregation"
(Drive, 16 Jun 2026).
"""

import re
from typing import Any, Dict, List

from .executive import NAMA_PERUSAHAAN

SECTIONS = (
    "## Gap Utama per HoD",
    "## Urutan Prioritas Bahasan",
    "## Pertanyaan Kritis Direktur",
    "## Keputusan Direktur Minggu Ini",
)


def build_senin_system(minggu_label: str, periode: str, health: str, minggu_rapat: str = "") -> str:
    rapat = minggu_rapat or "minggu berikutnya"
    return (
        f"Kamu analis kantor Direktur {NAMA_PERUSAHAAN}. Tugasmu menyiapkan bahan "
        f"rapat HoD hari Senin awal {rapat}, yang mengevaluasi minggu {minggu_label} "
        f"({periode}) yang sudah tutup.\n\n"
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
        "4. Kritis, tegas, tanpa basa-basi atau pujian kosong. Bahasa Indonesia baku "
        "yang rapi (istilah teknis boleh), tanpa campuran bahasa Inggris yang tak perlu.\n"
        "5. Jangan pakai tanda kurung sudut (< >) dan jangan pakai garis pemisah (---).\n"
        "6. Usulan keputusan harus OPERASIONAL dan berpijak pada data di input: siapa "
        "melengkapi data apa, deal/akun mana yang ditinjau, tenggat. DILARANG mengusulkan "
        "sanksi, hukuman, pemotongan/pembatalan bonus, ancaman, mengeluarkan orang dari "
        "rapat, PHK, rotasi jabatan, outsourcing, atau inisiatif baru yang tak disebut di "
        "input — itu wewenang Direktur, bukan bahan usulan otomatis. Jangan menyebut "
        "bonus, insentif, atau kompensasi dalam bentuk apa pun (hadiah maupun potongan), "
        "dan jangan menyebut jabatan/orang yang tak ada di input (mis. CFO, analis, PM).\n"
        "7. Jangan menilai karakter atau niat orang ('tidak peduli', 'mati', 'blank "
        "total'); sebut faktanya saja (mis. '0/5 metric terisi').\n"
        f"8. Minggu {minggu_label} sudah lewat. Semua tenggat ditulis relatif terhadap "
        f"minggu rapat {rapat} (mis. 'Rabu {rapat}', 'sebelum rapat Senin depan'); "
        "jangan mengarang nomor minggu atau tanggal lain.\n\n"
        "TULIS PERSIS empat bagian markdown ini, berurutan, tanpa judul lain:\n"
        "## Gap Utama per HoD\n"
        "Per HoD: baris '**Nama** — STATUS' lalu maksimal 3 bullet gap paling "
        "penting (dari cek yang gagal + metric merah/memburuk). HoD SIAP cukup 1 "
        "bullet hal yang perlu dijaga.\n"
        "## Urutan Prioritas Bahasan\n"
        "Daftar bernomor SEMUA HoD. Urutkan menurut DAMPAK BISNIS lebih dulu (selisih "
        "revenue/AR/kas terhadap target, metric merah bernilai besar), baru kesiapan "
        "data. HoD yang datanya kosong tetap dibahas, tapi kosongnya data bukan otomatis "
        "nomor satu. Tiap baris satu alasan singkat berangka.\n"
        "## Pertanyaan Kritis Direktur\n"
        "Per HoD tepat 2 pertanyaan tajam yang Direktur ajukan saat presentasi, "
        "berpijak pada angka/gap di input.\n"
        "## Keputusan Direktur Minggu Ini\n"
        "3–5 keputusan, daftar bernomor. Tiap keputusan: judul tebal satu baris, lalu "
        "SATU paragraf maksimal 60 kata berisi konteks berangka + usulan konkret "
        "(siapa, apa, tenggat). Tanpa sub-bullet."
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
    dari model) supaya brief tak punya dua judul, plus garis pemisah markdown
    (---/***) yang tetap dipakai model walau dilarang. Kalau tak satu pun bagian
    ditemukan, kembalikan string kosong — lebih jujur daripada narasi ngawur."""
    t = (text or "").strip()
    idx = [t.find(s) for s in SECTIONS if t.find(s) >= 0]
    if not idx:
        return ""
    baris = [b for b in t[min(idx):].split("\n") if not re.fullmatch(r"\s*([-*_])\1{2,}\s*", b)]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(baris)).strip()
