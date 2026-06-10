from typing import List, Optional

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
