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
