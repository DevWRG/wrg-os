import os

from fastapi import FastAPI

from .compress import wrg_compress
from .openrouter import chat
from .schemas import (
    DailySummaryRequest,
    DailySummaryResponse,
    DigestResponse,
    SummarizeRequest,
)

# System prompt stabil (cache-friendly) — port dari legacy/crm wrg-daily SKILL.md.
DAILY_SYSTEM_PROMPT = """Kamu adalah WRG CRM Daily Summary Generator.
Buat ringkasan harian aktivitas tim sales PT Wahana Rizky Gumilang.

FORMAT OUTPUT WAJIB:
📊 *Daily Summary — {hari}, {tanggal}*

*Overview*
• {N} anggota aktif dari {total} tim
• {total_report} laporan masuk
• {matched}% sesuai plan, {unmatched} aktivitas di luar plan

*Per Area*
[untuk setiap area: ringkasan 2-3 kalimat tentang aktivitas hari ini]

*Highlight*
[maks 3 poin penting hari ini — deal hot, prospek baru, warning]

*Perhatian*
[anggota yang tidak plan/report hari ini, jika ada]

Gunakan Bahasa Indonesia. Singkat, informatif, eksekutif. Maksimal 30 baris."""

app = FastAPI(title="WRG AI Service", version="0.0.1")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "wrg-ai"}


@app.post("/summarize", response_model=DigestResponse)
def summarize(req: SummarizeRequest) -> DigestResponse:
    # TODO (Fase 4+): panggil OpenRouter (Claude Haiku 4.5 primary / DeepSeek
    # fallback) seperti legacy/crm wrg-daily.sh daily_summary & legacy/monitor
    # rekap.sh. Sekarang: ringkasan deterministik dari input, tanpa LLM.
    bullets = [item.strip() for item in req.items if item.strip()][:10]
    return DigestResponse(
        group_jid=req.group_jid,
        period_start=req.period_start,
        period_end=req.period_end,
        bullets=bullets,
        action_items=[],
        konfirmasi_items=[],
        model="stub",
    )


@app.post("/daily-summary", response_model=DailySummaryResponse)
def daily_summary(req: DailySummaryRequest) -> DailySummaryResponse:
    """Ringkasan harian: compress aktivitas → LLM (OpenRouter Haiku/DeepSeek).

    dry_run=true atau tanpa OPENROUTER_API_KEY → kembalikan prompt terkompres
    (tanpa panggil LLM) supaya bisa di-test tanpa kredensial.
    """
    compressed = wrg_compress(req.rows)
    s = req.stats
    user_msg = (
        "============================================\n"
        "DATA INPUT (compressed):\n"
        f"{compressed}\n\n"
        "STATS:\n"
        f"anggota_aktif={s.anggota_aktif} | total_report={s.total_report} | "
        f"matched={s.matched} | unmatched={s.unmatched} | anggota_plan={s.anggota_plan}\n"
        "============================================"
    )
    system = DAILY_SYSTEM_PROMPT.replace("{hari}", req.hari).replace(
        "{tanggal}", req.tanggal
    )

    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return DailySummaryResponse(
            summary=f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user_msg}",
            model="dry-run",
            dry_run=True,
        )

    text, model, tin, tout = chat(system, user_msg)
    return DailySummaryResponse(
        summary=text, model=model, tokens_in=tin, tokens_out=tout, dry_run=False
    )
