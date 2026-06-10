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


class DailySummaryRequest(BaseModel):
    hari: str  # nama hari Indonesia, mis. "Kamis"
    tanggal: str  # mis. "21 Mei 2026"
    stats: SummaryStats
    rows: List[ActivityRow] = Field(default_factory=list)
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
