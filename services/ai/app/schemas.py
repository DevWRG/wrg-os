from typing import Dict, List, Optional

from pydantic import BaseModel, Field

# Skema mirror dgn @wrg/types (packages/types) — kontrak lintas-tier dijaga selaras.


class SummarizeRequest(BaseModel):
    group_jid: str
    group_name: Optional[str] = None
    period_start: str  # ISO-8601
    period_end: str
    items: List[str] = Field(
        default_factory=list,
        description="Pesan/aktivitas mentah grup untuk diringkas",
    )


class DigestResponse(BaseModel):
    """Mirror DigestRekap (@wrg/types) + metadata model."""

    group_jid: str
    period_start: str
    period_end: str
    bullets: List[str]
    action_items: List[str]
    konfirmasi_items: List[str]
    model: str = "stub"


# === Daily Summary (port legacy/crm wrg-daily daily_summary) ===


class ActivityRow(BaseModel):
    nama: str
    area: Optional[str] = None
    customer: str
    hasil: str
    next_action: str = ""
    tujuan: Optional[str] = None
    is_unmatched: bool = False


class SummaryStats(BaseModel):
    anggota_aktif: int = 0
    total_report: int = 0
    matched: int = 0
    unmatched: int = 0
    anggota_plan: int = 0
    wajib_total: int = 0  # total user wajib lapor (sudah exclude yg ijin hari ini)


class DailySummaryRequest(BaseModel):
    hari: str  # nama hari Indonesia, mis. "Kamis"
    tanggal: str  # mis. "21 Mei 2026"
    stats: SummaryStats
    rows: List[ActivityRow] = Field(default_factory=list)
    # List nama eksplisit untuk section Perhatian/Ijin — anti-halusinasi: LLM hanya
    # boleh pakai nama dari list ini, tidak mengarang.
    no_plan: List[str] = Field(default_factory=list)
    non_reporters: List[str] = Field(default_factory=list)
    on_leave: List[str] = Field(default_factory=list)
    dry_run: bool = False


class DailySummaryResponse(BaseModel):
    summary: str
    model: str
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    dry_run: bool = False


# === Monitor Rekap (port legacy/monitor rekap.sh, mode "rekap") ===


class RekapMessage(BaseModel):
    jid: str  # group JID
    ts_ms: int  # timestamp ms
    sender: str  # sender_name atau nomor
    body: str
    media: Optional[str] = None  # media_type kalau ada


class RekapRequest(BaseModel):
    jam: str  # "14:00"
    tanggal: str  # "2026-05-21"
    window_label: str = "5 jam terakhir"
    messages: List[RekapMessage] = Field(default_factory=list)
    members: Optional[Dict[str, str]] = None  # nomor → nama
    groups: Optional[Dict[str, str]] = None  # JID → nama grup
    dry_run: bool = False


class RekapResponse(BaseModel):
    rekap: str
    model: str
    grup_aktif: int = 0
    jumlah_pesan: int = 0
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    dry_run: bool = False


# === Monitor Resume (port legacy/monitor rekap.sh, mode "resume") ===


class RekapDoc(BaseModel):
    label: str  # header rekap, mis. "2026-05-21 1400"
    text: str  # isi rekap


class ResumeRequest(BaseModel):
    jam: str
    tanggal: str
    rekaps: List[RekapDoc] = Field(default_factory=list)
    window_label: str = "7 Jam Terakhir"
    nama_direktur: str = "Pak Gilang"
    members: Optional[Dict[str, str]] = None
    groups: Optional[Dict[str, str]] = None
    dry_run: bool = False


class ResumeResponse(BaseModel):
    resume: str
    model: str
    jumlah_rekap: int = 0
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    dry_run: bool = False


# === A3 Sari Collection Drafter (draft pesan penagihan per invoice overdue) ===


class CollectionItem(BaseModel):
    customer_id: str
    customer_name: Optional[str] = None
    invoice_no: str
    amount: float = 0
    days_overdue: int = 0
    bucket: str = ""


class CollectionDraftRequest(BaseModel):
    items: List[CollectionItem] = Field(default_factory=list)
    draft_type: str = "whatsapp"  # whatsapp, email, formal_letter
    dry_run: bool = False


class DraftedItem(BaseModel):
    customer_id: str
    invoice_no: str
    draft_text: str


class CollectionDraftResponse(BaseModel):
    drafts: List[DraftedItem] = Field(default_factory=list)
    draft_type: str
    model: str
    count: int = 0
    dry_run: bool = False


# === A6 Sales Doc Drafter (draft dokumen penjualan dari konteks deal) ===


class SalesDocRequest(BaseModel):
    customer_name: Optional[str] = None
    am_id: str = ""
    stage: str = ""
    estimated_value: float = 0
    product_ids: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    doc_type: str = "sph"  # sph, offering_letter, presentation, mou
    dry_run: bool = False
    # F15 (apps/api/src/repo/sph.ts) — True kalau pemanggil SUDAH punya tabel
    # harga final (per-SKU, tervalidasi) dan akan menempelnya sendiri setelah
    # teks ini. LLM/template TIDAK BOLEH ikut menggambar tabel/subtotal/PPN
    # sendiri kalau ini True — dua tabel (satu placeholder, satu benar) di 1
    # dokumen membingungkan customer. False (default) = jalur lama A6 batch,
    # tak ada tabel final tersedia, LLM/template tetap boleh gambar placeholder.
    has_final_pricing: bool = False


class SalesDocResponse(BaseModel):
    doc_type: str
    title: str
    draft_text: str
    model: str
    dry_run: bool = False


# === A8 Sentiment & Entity Extraction (anotasi per pesan WhatsApp) ===


class ExtractMessage(BaseModel):
    id: str
    sender: Optional[str] = None
    body: str = ""


class ExtractRequest(BaseModel):
    messages: List[ExtractMessage] = Field(default_factory=list)
    dry_run: bool = False


class Entity(BaseModel):
    type: str  # customer, product, person, amount, org
    value: str


class Annotation(BaseModel):
    id: str
    sentiment: str  # positive, neutral, negative
    sentiment_score: float = 0.0  # -1..1
    entities: List[Entity] = Field(default_factory=list)


class ExtractResponse(BaseModel):
    annotations: List[Annotation] = Field(default_factory=list)
    model: str
    count: int = 0
    dry_run: bool = False


# === A10 Executive Synthesis (briefing eksekutif lintas-domain) ===


class ExecSynthesisRequest(BaseModel):
    signals: dict = Field(default_factory=dict)
    period_label: str = "harian"
    dry_run: bool = False


class ExecSynthesisResponse(BaseModel):
    briefing: str
    model: str
    dry_run: bool = False


# (GrowthLevers schema di-export lewat schemas; endpoint di main.py)
class GrowthLeversRequest(BaseModel):
    signals: dict = Field(default_factory=dict)
    period_label: str = "minggu ini"
    dry_run: bool = False


class GrowthLeversResponse(BaseModel):
    levers: list = Field(default_factory=list)
    model: str
    dry_run: bool = False


# === detect_leave (deteksi izin/sakit/cuti dari grup HRD via LLM) ===


class LeaveDetectRequest(BaseModel):
    sender: str = ""  # nama tampilan pengirim
    body: str  # isi pesan WA
    msgdate: str  # tanggal pesan YYYY-MM-DD (untuk resolve "hari ini"/"besok")
    dry_run: bool = False


class LeaveDetectResponse(BaseModel):
    is_leave: bool = False
    nama: Optional[str] = None
    jenis: Optional[str] = None  # ijin | sakit | cuti
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    confidence: float = 0.0
    model: str = "dry-run"
    dry_run: bool = False


# === extract_competitor (ekstrak sebutan kompetitor dari activity_log.hasil) ===


class CompetitorMention(BaseModel):
    vendor: Optional[str] = None
    produk: Optional[str] = None
    produk_kategori: Optional[str] = None
    harga_text: Optional[str] = None
    harga_numeric: Optional[float] = None
    konteks: Optional[str] = None


class CompetitorExtractRequest(BaseModel):
    customer: str = ""
    tanggal: str = ""
    hasil: str
    dry_run: bool = False


class CompetitorExtractResponse(BaseModel):
    mentions: List[CompetitorMention] = Field(default_factory=list)
    model: str = "dry-run"
    dry_run: bool = False


# === briefing_weekend (briefing direktur akhir pekan dari resume 7 hari) ===


class PolaProfile(BaseModel):
    jid: str
    content: str


class WeekendBriefingRequest(BaseModel):
    tanggal: str
    minggu_label: str
    nama_direktur: str = "Pak Gilang"
    resumes: List[RekapDoc] = Field(default_factory=list)
    members: Optional[Dict[str, str]] = None
    groups: Optional[Dict[str, str]] = None
    pola: List[PolaProfile] = Field(default_factory=list)
    dry_run: bool = False


class WeekendBriefingResponse(BaseModel):
    briefing: str
    model: str = "dry-run"
    dry_run: bool = False


# === pola_komunikasi (profil pola komunikasi per grup) ===


class PolaProfileRequest(BaseModel):
    group_label: str
    group_name: str = ""
    window_days: int = 7
    count: int = 0
    stats_json: str = "{}"  # statistik lokal (top_senders/active_hours/media) sbg JSON string
    sample: str = ""        # sample pesan terakhir (urut waktu, body dipotong)
    timestamp: str = ""     # untuk baris "Generated:"
    dry_run: bool = False


class PolaProfileResponse(BaseModel):
    profile: str
    model: str = "dry-run"
    dry_run: bool = False


# Raport 360 — narasi penilaian kinerja (Fase 3)
class RaportNarrativeRequest(BaseModel):
    signals: Dict[str, object] = Field(default_factory=dict, description="Metrik+konteks raport 1 karyawan/periode")
    period_label: str = ""
    dry_run: bool = False


class RaportNarrativeResponse(BaseModel):
    verdict: str
    headline: str
    pantas_puas: List[str] = Field(default_factory=list)
    penahan: List[str] = Field(default_factory=list)
    bsc: Dict[str, str] = Field(default_factory=dict)
    akar_masalah: str = ""
    catatan_adil: str = ""
    ringkasan: str = ""
    predikat: str = ""
    model: str = "dry-run"
    dry_run: bool = False
