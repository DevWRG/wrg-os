from .schemas import SalesDocRequest

# A6 — Sales Doc Drafter. Susun dokumen penjualan WRG (distributor alkes B2B)
# dari konteks deal. Template dry-run di bawah dipakai tanpa OPENROUTER_API_KEY.

NAMA_PERUSAHAAN = "PT Wahana Rizky Gumilang (WRG)"

DOC_LABEL = {
    "sph": "Surat Penawaran Harga (SPH)",
    "offering_letter": "Offering Letter",
    "presentation": "Kerangka Presentasi",
    "mou": "Nota Kesepahaman (MOU)",
}

_DOC_INSTRUKSI = {
    "sph": (
        "Susun Surat Penawaran Harga formal: kop ringkas, nomor & tanggal "
        "(placeholder), tujuan pelanggan, tabel item penawaran (gunakan "
        "product_ids sebagai placeholder kode produk), subtotal/PPN/total "
        "(placeholder dari estimated_value), syarat & ketentuan, masa berlaku, "
        "penutup + tanda tangan."
    ),
    "offering_letter": (
        "Susun Offering Letter persuasif namun formal: pembuka relasi, ringkas "
        "kebutuhan pelanggan, nilai yang ditawarkan WRG, indikasi nilai kerja "
        "sama (dari estimated_value), ajakan tindak lanjut."
    ),
    "presentation": (
        "Susun KERANGKA presentasi (bullet per slide, 6-8 slide): judul, "
        "profil WRG, pemahaman kebutuhan, solusi/produk, keunggulan & layanan "
        "purna jual, indikasi komersial, langkah selanjutnya."
    ),
    "mou": (
        "Susun draft Nota Kesepahaman (MOU) kerangka: para pihak (placeholder), "
        "maksud & tujuan, ruang lingkup, hak & kewajiban garis besar, jangka "
        "waktu, penutup. Tegaskan ini draft, bukan kontrak final."
    ),
}


def rupiah(n: float) -> str:
    return f"Rp{int(round(n)):,}".replace(",", ".")


def doc_title(req: SalesDocRequest) -> str:
    label = DOC_LABEL.get(req.doc_type, req.doc_type)
    cust = req.customer_name or "(pelanggan)"
    return f"{label} — {cust}"


def build_salesdoc_system(doc_type: str) -> str:
    instruksi = _DOC_INSTRUKSI.get(doc_type, _DOC_INSTRUKSI["sph"])
    return (
        f"Kamu adalah staf penjualan {NAMA_PERUSAHAAN}, distributor alat "
        "kesehatan B2B (reagen lab, alat diagnostik & medis) ke RS, lab, klinik, "
        "apotek di Indonesia.\n"
        f"Tugas: susun {DOC_LABEL.get(doc_type, doc_type)} dalam Bahasa Indonesia "
        "yang rapi, profesional, dan siap direview.\n"
        f"{instruksi}\n"
        "Gunakan placeholder [dalam kurung siku] untuk data yang belum tersedia. "
        "Keluarkan HANYA isi dokumen, tanpa penjelasan tambahan."
    )


def build_salesdoc_user(req: SalesDocRequest) -> str:
    produk = ", ".join(req.product_ids) if req.product_ids else "(belum ada kode produk)"
    return (
        f"Pelanggan: {req.customer_name or '(belum ada)'}\n"
        f"Account Manager: {req.am_id or '(belum ada)'}\n"
        f"Stage deal: {req.stage or '(belum ada)'}\n"
        f"Estimasi nilai: {rupiah(req.estimated_value)}\n"
        f"Produk: {produk}\n"
        f"Catatan: {req.notes or '(tidak ada)'}\n"
        "Susun dokumennya."
    )


def template_doc(req: SalesDocRequest) -> str:
    """Draft deterministik (dry-run / tanpa LLM)."""
    cust = req.customer_name or "[Pelanggan]"
    produk = ", ".join(req.product_ids) if req.product_ids else "[kode produk]"
    nilai = rupiah(req.estimated_value)
    if req.doc_type == "presentation":
        return (
            f"KERANGKA PRESENTASI — {cust}\n\n"
            f"1. Pembuka: {NAMA_PERUSAHAAN}\n"
            "2. Profil WRG & izin distribusi alkes (IPAK/CDAKB)\n"
            f"3. Pemahaman kebutuhan {cust}\n"
            f"4. Solusi & produk: {produk}\n"
            "5. Keunggulan: ketersediaan, layanan teknis, purna jual\n"
            f"6. Indikasi komersial: {nilai}\n"
            "7. Langkah selanjutnya & timeline\n"
        )
    if req.doc_type == "mou":
        return (
            f"NOTA KESEPAHAMAN (DRAFT)\n\nAntara {NAMA_PERUSAHAAN} dan {cust}.\n\n"
            "1. Maksud & Tujuan: kerangka kerja sama pengadaan alat kesehatan.\n"
            f"2. Ruang Lingkup: penyediaan {produk}.\n"
            "3. Hak & Kewajiban: [garis besar para pihak].\n"
            "4. Jangka Waktu: [mulai]–[selesai].\n"
            f"5. Indikasi Nilai: {nilai}.\n\n"
            "Catatan: dokumen ini DRAFT, bukan kontrak final.\n"
        )
    if req.doc_type == "offering_letter":
        return (
            f"OFFERING LETTER\n\nKepada Yth. {cust},\n\n"
            f"{NAMA_PERUSAHAAN} dengan hormat menyampaikan penawaran kerja sama "
            f"penyediaan {produk}. Kami memahami kebutuhan Bapak/Ibu dan siap "
            "mendukung dengan ketersediaan stok, layanan teknis, serta purna "
            f"jual. Indikasi nilai kerja sama: {nilai}.\n\n"
            "Kami menantikan kesempatan menindaklanjuti penawaran ini.\n\n"
            "Hormat kami,\nTim Penjualan WRG\n"
        )
    # default: sph
    return (
        f"SURAT PENAWARAN HARGA (SPH)\nNomor: [nomor] | Tanggal: [tanggal]\n\n"
        f"Kepada Yth. {cust}\n\nBersama ini {NAMA_PERUSAHAAN} menyampaikan "
        "penawaran harga sebagai berikut:\n\n"
        f"| No | Kode/Produk | Qty | Harga Satuan | Jumlah |\n"
        f"| 1  | {produk} | [qty] | [harga] | [jumlah] |\n\n"
        f"Subtotal: [subtotal]\nPPN 11%: [ppn]\nTotal: {nilai} (estimasi)\n\n"
        "Syarat & Ketentuan: [pembayaran], [pengiriman]. Masa berlaku: [14 hari].\n\n"
        "Hormat kami,\nTim Penjualan WRG\n"
    )
