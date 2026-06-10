from typing import Dict, List, Optional

from .schemas import RekapMessage

# Port dari legacy/monitor/scripts/rekap.sh (mode "rekap"). Konstanta WRG default;
# bisa di-override lewat field request kalau perlu.
NAMA_PERUSAHAAN = "PT Wahana Rizky Gumilang (WRG)"
KONTEKS_BISNIS = (
    "Distribusi alat kesehatan B2B (reagen lab, alat diagnostik & medis) "
    "ke RS, lab, klinik, dan apotek di Indonesia."
)


def _directory(d: Optional[Dict[str, str]]) -> str:
    if not d:
        return ""
    return "\n".join(f"• {k} → {v}" for k, v in d.items() if v)


def build_messages_block(messages: List[RekapMessage]) -> str:
    """Format pesan: [jid] [ts_ms] sender: body <media:...>, urut waktu."""
    lines = []
    for m in sorted(messages, key=lambda x: x.ts_ms):
        media = f" <media:{m.media}>" if m.media else ""
        lines.append(f"[{m.jid}] [{m.ts_ms}] {m.sender}: {m.body}{media}")
    return "\n".join(lines)


def build_rekap_system(
    jam: str,
    tanggal: str,
    grup_aktif: int,
    members: Optional[Dict[str, str]],
    groups: Optional[Dict[str, str]],
) -> str:
    """Stable-prefix system prompt (cache-friendly) — instruksi + direktori + format eksak."""
    group_dir = _directory(groups) or "(belum ada group_directory)"
    members_table = _directory(members) or "(belum ada members.json)"
    return f"""Kamu adalah asisten internal {NAMA_PERUSAHAAN}.
Konteks: {KONTEKS_BISNIS}

============================================
DIREKTORI GRUP (substitusi JID grup → nama grup saat output: kalau JID di pesan
muncul di list ini, GANTI dengan nama grup di header section per-grup; kalau tidak
ada di list, pakai JID apa adanya):
{group_dir}

============================================
DIREKTORI MEMBER (substitusi nomor telpon ke nama saat output: kalau nomor di pesan
muncul di list ini, GANTI dengan nama; kalau tidak ada di list, pakai nomor seperti
apa adanya — JANGAN tebak nama):
{members_table}

============================================
TUGAS: Buat REKAP RINGKAS dengan struktur EKSAK seperti di bawah.

PER GRUP — daftar poin penting + ACTION items (PIC + tugas + deadline kalau ada).

DETEKSI KONFIRMASI: untuk setiap REQUEST/APPROVAL/PERTANYAAN yang ditujukan ke PIC tertentu
(via @mention, panggilan langsung 'pak X', 'bu Y', atau request kolektif '@all'), match dengan
reply dari PIC tersebut DALAM SAMA WINDOW. Pola reply yang dihitung sebagai konfirmasi:
- Eksplisit: 'OK', 'siap', 'noted', 'setuju', 'ya', 'bisa', 'jalan', 'lanjut', 'acc'
- Action-taken: PIC sudah mulai/selesai tugas yang diminta
- Quote-reply ke message tersebut dengan jawaban substantif
Pola yang TIDAK dihitung sebagai konfirmasi: emoji reaction saja, 'oh', 'siap nanti', 'akan dicek', 'menyusul'.

Format output EKSAK:

REKAP WRG | {jam} WIB | {tanggal}
============================================
[nama grup dari DIREKTORI GRUP — kalau JID ada di direktori, WAJIB pakai nama; kalau tidak ada, tulis JID apa adanya]
• poin penting
→ ACTION: [PIC] - [tugas] [deadline jika ada]

============================================
KONFIRMASI STATUS (5 jam terakhir)

✓ SUDAH DIKONFIRMASI:
• [topik singkat] | dari: [requester] | ke: [PIC] | confirm by: [siapa yang reply] @ [jam]
(jika tidak ada, tulis 'Tidak ada')

⏳ MENUNGGU KONFIRMASI:
• [topik singkat] | dari: [requester] | ke: [PIC yang dituju, atau '@all'] | sejak: [jam request] | status: [reason kalau tahu, misal 'belum dijawab' / 'menyusul' / 'pending data']
(jika tidak ada, tulis 'Tidak ada')

============================================
URGENT: [item urgent, atau 'Tidak ada']
GRUP AKTIF: {grup_aktif} grup

Gunakan Bahasa Indonesia. Singkat, padat. Ikuti format di atas persis."""
