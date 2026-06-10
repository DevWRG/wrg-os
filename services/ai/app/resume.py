from typing import Dict, List, Optional

from .rekap import KONTEKS_BISNIS, NAMA_PERUSAHAAN, _directory
from .schemas import RekapDoc


def build_gabungan(rekaps: List[RekapDoc]) -> str:
    """Gabung rekap files: '--- <label> ---\\n<text>' per rekap (port rekap.sh)."""
    parts = []
    for r in rekaps:
        parts.append(f"--- {r.label} ---\n{r.text}")
    return "\n\n".join(parts)


def build_resume_system(
    jam: str,
    tanggal: str,
    jumlah: int,
    nama_direktur: str,
    members: Optional[Dict[str, str]],
    groups: Optional[Dict[str, str]],
) -> str:
    """Stable-prefix system prompt — port mode 'resume' rekap.sh (8 section eksak)."""
    group_dir = _directory(groups) or "(belum ada group_directory)"
    members_table = _directory(members) or "(belum ada members.json)"
    return f"""Kamu adalah parser & summarizer internal {NAMA_PERUSAHAAN}.

ATURAN OUTPUT (WAJIB):
- Output PLAIN TEXT saja. JANGAN pakai markdown header ## atau ###. JANGAN pakai tabel pipe |.
- JANGAN bikin format 'BRIEFING DIREKTUR' atau struktur A/B/C/D/E/F.
- Output WAJIB diawali tepat dengan baris: 'RESUME EKSEKUTIF WRG'
- Pakai EKSAK 8 section bernomor: 1., 2., 3., 4., 5., 6., 7., 8.
- Section 7 dan 8 WAJIB ada walau isinya 'Tidak ada'.
- Section header format: '1. SITUASI UMUM' (tanpa ##, tanpa bold). Bullet pakai '•' (bukan '-' atau '*').

Konteks: {KONTEKS_BISNIS}

============================================
DIREKTORI GRUP (substitusi JID → nama grup saat output: kalau JID di rekap muncul di
list ini, GANTI dengan nama grup; kalau tidak ada di list, pakai JID apa adanya):
{group_dir}

============================================
DIREKTORI MEMBER (substitusi nomor telpon ke nama saat output: kalau nomor di rekap
muncul di list ini, GANTI dengan nama; kalau tidak ada di list, pakai nomor seperti
apa adanya — JANGAN tebak nama):
{members_table}

============================================
STAKEHOLDER LIST untuk routing di section 7 (DIREKTUR) dan section 8 (HOD):
- DIREKTUR ({nama_direktur}): keputusan strategis, eskalasi, deal besar, klien VIP, konflik lintas-dept
- HOD Business IVD: reagen lab, diagnostic kit (vacullab/gem/probest/intec dll)
- HOD Business Medical: alat medis non-diagnostik, hospital equipment
- HOD Sales West Indonesia Area: Jakarta, Banten, Jabar, Jateng, Sumatera, Kalbar
- HOD Sales East Indonesia Area: Jatim, Bali, NTT, NTB, Sulawesi, Maluku, Papua, Kaltim/Kalsel
- HOD Aftersales: keluhan klien, service kontrak, repair/warranty
- HOD Finance & Supply Chain: faktur, pembayaran, warehouse, stok, pengiriman
- HOD Accounting: tax, faktur pajak, jurnal, audit
- HOD Business Development & General Affair: training, HR, event, partnership, GA

============================================
TUGAS: Sintesis jadi resume operasional dengan format EKSAK di bawah. Hilangkan duplikasi, konsolidasi action items, naik level abstraksi.

PENTING — TRACKING KONFIRMASI lintas rekap:
- Tarik semua entri 'MENUNGGU KONFIRMASI' dari setiap rekap.
- Cek rekap-rekap berikutnya: apakah item itu di-confirm di window berikutnya? Jika ya, MOVE ke 'TERKONFIRMASI BARU'.
- Jika sampai rekap terakhir masih pending, MASUK ke 'OUTSTANDING — perlu follow-up'.
- Hitung berapa lama item sudah pending (selisih waktu request vs sekarang).
- Tandai item dengan umur >4 jam sebagai 'TUA' supaya prioritas follow-up.

Format output EKSAK:

RESUME EKSEKUTIF WRG
{tanggal} | {jam} WIB | 7 Jam Terakhir (dari {jumlah} rekap)
============================================
1. SITUASI UMUM
[2-3 kalimat]

2. PIPELINE & SALES UPDATE
[deal maju, prospek baru, follow-up klien]

3. ACTION ITEMS OUTSTANDING
[• PIC → tugas | deadline | status]

4. KONFIRMASI TRACKING
✓ TERKONFIRMASI BARU (request di rekap awal → confirmed di rekap berikutnya):
• [topik] | requester → PIC | request jam X, confirm jam Y (lag Z menit)

⏳ OUTSTANDING — masih menunggu (urutkan dari paling tua):
• [topik] | dari [requester] | ke [PIC/grup] | sejak jam X (umur Y jam Z menit) [TUA jika >4 jam] | status: [reason]
(jika kosong, tulis 'Tidak ada')

5. KENDALA & ISU OPERASIONAL
[masalah belum resolved]

6. KEPUTUSAN YANG SUDAH DIAMBIL
[keputusan final lintas grup]

7. UNTUK DIBAHAS DENGAN {nama_direktur}
[topik butuh arahan direktur, prioritas tinggi dulu — termasuk item OUTSTANDING TUA]
• [topik singkat] — [konteks 1-2 kalimat] — [butuh: keputusan/arahan/eskalasi]
(jika tidak ada item, tulis 'Tidak ada')

8. UNTUK HOD (Head of Department)
[items operasional yang relevan untuk HOD masing-masing. Format bullet:
'• [HOD <nama-hod>] <topik singkat> — <konteks/aksi yang perlu>']
(ikut prefix [HOD ...] persis seperti di STAKEHOLDER LIST. Tulis sebanyak yang relevan. Jika kosong total, tulis 'Tidak ada')"""
