from .schemas import CollectionItem

# A3 — Sari Collection Drafter. "Sari" = persona penagihan WRG: sopan, tegas,
# berempati, B2B alkes. Satu pesan per invoice overdue. Template dry-run di
# bawah dipakai saat tanpa OPENROUTER_API_KEY (deterministik, siap-pakai).

NAMA_PERUSAHAAN = "PT Wahana Rizky Gumilang (WRG)"

_TYPE_GAYA = {
    "whatsapp": "pesan WhatsApp singkat (3-5 kalimat), hangat tapi tegas, boleh 1 emoji 🙏",
    "email": "email formal dengan salam pembuka & penutup, 1-2 paragraf",
    "formal_letter": "surat penagihan formal berbahasa baku, tanpa emoji",
}


def rupiah(n: float) -> str:
    return f"Rp{int(round(n)):,}".replace(",", ".")


def build_collection_system(draft_type: str) -> str:
    gaya = _TYPE_GAYA.get(draft_type, _TYPE_GAYA["whatsapp"])
    return (
        f"Kamu adalah 'Sari', staf penagihan (collection) {NAMA_PERUSAHAAN}, "
        "distributor alat kesehatan B2B (RS, lab, klinik, apotek).\n"
        "Tugas: susun SATU draft pesan penagihan untuk satu invoice yang sudah "
        "jatuh tempo, dalam Bahasa Indonesia.\n"
        f"Gaya: {gaya}.\n"
        "Selalu: sebut nomor invoice & nominal, sebut umur tunggakan, minta "
        "konfirmasi jadwal bayar atau kanal klarifikasi, jaga hubungan baik. "
        "JANGAN mengancam, JANGAN menambah denda yang tidak diberikan. "
        "Keluarkan HANYA teks pesan final, tanpa penjelasan."
    )


def build_collection_user(item: CollectionItem) -> str:
    nama = item.customer_name or item.customer_id
    return (
        f"Pelanggan: {nama}\n"
        f"Invoice: {item.invoice_no}\n"
        f"Nominal: {rupiah(item.amount)}\n"
        f"Umur tunggakan: {item.days_overdue} hari (bucket {item.bucket})\n"
        "Susun draft pesannya."
    )


def template_draft(item: CollectionItem, draft_type: str) -> str:
    """Draft deterministik (dry-run / tanpa LLM) — sudah layak dikirim."""
    nama = item.customer_name or item.customer_id
    inti = (
        f"invoice {item.invoice_no} sebesar {rupiah(item.amount)} telah jatuh "
        f"tempo {item.days_overdue} hari (kategori {item.bucket})"
    )
    if draft_type == "formal_letter":
        return (
            f"Kepada Yth. {nama},\n\n"
            f"Bersama surat ini kami dari {NAMA_PERUSAHAAN} menyampaikan bahwa {inti}. "
            "Kami mohon Bapak/Ibu berkenan menyelesaikan kewajiban pembayaran tersebut "
            "atau menghubungi tim penagihan kami untuk pengaturan jadwal.\n\n"
            "Atas perhatian dan kerja samanya kami ucapkan terima kasih.\n\n"
            "Hormat kami,\nTim Penagihan WRG"
        )
    if draft_type == "email":
        return (
            f"Yth. {nama},\n\n"
            f"Kami ingin mengingatkan dengan hormat bahwa {inti}. "
            "Mohon konfirmasi jadwal pembayaran atau sampaikan bila ada kendala "
            "agar dapat kami bantu tindak lanjuti.\n\n"
            "Terima kasih atas kerja samanya.\n\nSalam,\nSari — Tim Penagihan WRG"
        )
    # default: whatsapp
    return (
        f"Yth. {nama}, kami dari WRG ingin mengingatkan dengan hormat bahwa {inti}. "
        "Mohon konfirmasi jadwal pembayaran atau hubungi tim AR kami bila ada kendala. "
        "Terima kasih atas kerja samanya 🙏\n— Sari, Tim Penagihan WRG"
    )
