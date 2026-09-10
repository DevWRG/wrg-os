import json
import re
from typing import Optional

# DOC #KLAIM — Invoice Claim OCR (Fase A). Klasifikasi bisnis "klaim" belum
# didefinisikan Direktur (Owner blueprint kosong) — tugas LLM di sini murni
# EKSTRAKSI apa yang tercetak di foto, bukan interpretasi jenis klaim.

_SYSTEM = (
    "Kamu adalah asisten OCR dokumen (invoice/faktur/struk/nota) untuk PT Wahana "
    "Rizky Gumilang, distributor alat kesehatan B2B. Baca foto dokumen yang "
    "diberikan dan ekstrak informasi yang tercetak di dalamnya.\n"
    "Balas HANYA dengan JSON valid (tanpa markdown code-fence, tanpa penjelasan), "
    "bentuk persis:\n"
    '{"nomor_dokumen": string|null, "tanggal_dokumen": string|null, '
    '"nominal": string|null, "pihak": string|null, "raw_text": string}\n'
    "- nomor_dokumen: nomor invoice/faktur/struk yang tercetak (apa adanya).\n"
    "- tanggal_dokumen: tanggal yang tercetak di dokumen (apa adanya, jangan "
    "diformat ulang).\n"
    "- nominal: nominal total/jumlah yang tercetak (teks apa adanya termasuk "
    "simbol mata uang, JANGAN dikonversi angka).\n"
    "- pihak: nama toko/institusi/perusahaan yang tercetak di dokumen.\n"
    "- raw_text: SEMUA teks yang berhasil terbaca dari foto (transkrip penuh).\n"
    "Isi null kalau field itu tidak terbaca/tidak ada di foto — JANGAN mengada-ada."
)


def build_klaim_system() -> str:
    return _SYSTEM


def build_klaim_user(caption: Optional[str]) -> str:
    if caption and caption.strip():
        return f'Konteks dari pengirim: "{caption.strip()}"\n\nBaca dokumen di foto ini.'
    return "Baca dokumen di foto ini."


def parse_klaim(text: str) -> dict:
    """Parse respons LLM jadi dict field ekstraksi. Parse gagal (bukan JSON valid,
    mis. LLM nambah teks pembuka) → SEMUA field ekstraksi null KECUALI raw_text
    (diisi teks mentah respons, supaya tak hilang total — masih bisa dibaca manual)."""
    try:
        # LLM vision kadang tetap bungkus ```json ... ``` walau diminta tidak —
        # strip code-fence kalau ada sebelum json.loads.
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        data = json.loads(cleaned)
        return {
            "nomor_dokumen": data.get("nomor_dokumen"),
            "tanggal_dokumen": data.get("tanggal_dokumen"),
            "nominal": data.get("nominal"),
            "pihak": data.get("pihak"),
            "raw_text": data.get("raw_text") or "",
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            "nomor_dokumen": None,
            "tanggal_dokumen": None,
            "nominal": None,
            "pihak": None,
            "raw_text": text,
        }
