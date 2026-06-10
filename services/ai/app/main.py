import os

from fastapi import FastAPI

from .collection import build_collection_system, build_collection_user, template_draft
from .compress import wrg_compress
from .executive import build_exec_system, build_exec_user, template_briefing
from .extract import build_extract_system, parse_llm, rule_based
from .openrouter import (
    chat,
    collection_models,
    exec_models,
    extract_models,
    rekap_models,
    resume_models,
    salesdoc_models,
)
from .rekap import build_messages_block, build_rekap_system
from .resume import build_gabungan, build_resume_system
from .salesdoc import build_salesdoc_system, build_salesdoc_user, doc_title, template_doc
from .schemas import (
    CollectionDraftRequest,
    CollectionDraftResponse,
    DailySummaryRequest,
    DailySummaryResponse,
    DigestResponse,
    DraftedItem,
    ExecSynthesisRequest,
    ExecSynthesisResponse,
    ExtractRequest,
    ExtractResponse,
    RekapRequest,
    RekapResponse,
    ResumeRequest,
    ResumeResponse,
    SalesDocRequest,
    SalesDocResponse,
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


@app.post("/rekap", response_model=RekapResponse)
def rekap(req: RekapRequest) -> RekapResponse:
    """Monitor rekap (port legacy/monitor rekap.sh): pesan grup WA → REKAP terstruktur.

    dry_run / tanpa OPENROUTER_API_KEY → kembalikan prompt yang dirakit.
    """
    grup_aktif = len({m.jid for m in req.messages})
    system = build_rekap_system(
        jam=req.jam,
        tanggal=req.tanggal,
        grup_aktif=grup_aktif,
        members=req.members,
        groups=req.groups,
    )
    user = (
        f"Pesan dari {grup_aktif} grup WhatsApp WRG ({req.window_label}, urut waktu, "
        "format [grup_jid] [timestamp_ms] sender: body):\n\n"
        f"{build_messages_block(req.messages)}"
    )

    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return RekapResponse(
            rekap=f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user}",
            model="dry-run",
            grup_aktif=grup_aktif,
            jumlah_pesan=len(req.messages),
            dry_run=True,
        )

    text, model, tin, tout = chat(
        system, user, max_tokens=2000, models=rekap_models()
    )
    return RekapResponse(
        rekap=text,
        model=model,
        grup_aktif=grup_aktif,
        jumlah_pesan=len(req.messages),
        tokens_in=tin,
        tokens_out=tout,
        dry_run=False,
    )


@app.post("/resume", response_model=ResumeResponse)
def resume(req: ResumeRequest) -> ResumeResponse:
    """Resume eksekutif (port legacy/monitor rekap.sh mode 'resume'): gabung rekap
    7-jam → 8-section + tracking konfirmasi lintas-rekap + routing Direktur/HOD.

    dry_run / tanpa OPENROUTER_API_KEY → kembalikan prompt yang dirakit.
    """
    jumlah = len(req.rekaps)
    system = build_resume_system(
        jam=req.jam,
        tanggal=req.tanggal,
        jumlah=jumlah,
        nama_direktur=req.nama_direktur,
        members=req.members,
        groups=req.groups,
    )
    user = (
        f"Berikut {jumlah} rekap WhatsApp WRG dari {req.window_label.lower()} "
        f"({req.tanggal}):\n\n{build_gabungan(req.rekaps)}"
    )

    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return ResumeResponse(
            resume=f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user}",
            model="dry-run",
            jumlah_rekap=jumlah,
            dry_run=True,
        )

    text, model, tin, tout = chat(
        system, user, max_tokens=2500, models=resume_models()
    )
    return ResumeResponse(
        resume=text,
        model=model,
        jumlah_rekap=jumlah,
        tokens_in=tin,
        tokens_out=tout,
        dry_run=False,
    )


@app.post("/collection-draft", response_model=CollectionDraftResponse)
def collection_draft(req: CollectionDraftRequest) -> CollectionDraftResponse:
    """A3 Sari Collection Drafter: satu draft pesan penagihan per invoice overdue.

    dry_run / tanpa OPENROUTER_API_KEY → template deterministik (siap-pakai).
    Dengan LLM → satu panggilan per item (gaya 'Sari', sesuai draft_type).
    """
    use_llm = not req.dry_run and bool(os.environ.get("OPENROUTER_API_KEY"))
    system = build_collection_system(req.draft_type)
    drafts = []
    model_used = "dry-run"
    for item in req.items:
        if use_llm:
            text, model_used, _, _ = chat(
                system,
                build_collection_user(item),
                max_tokens=600,
                models=collection_models(),
            )
        else:
            text = template_draft(item, req.draft_type)
        drafts.append(
            DraftedItem(
                customer_id=item.customer_id,
                invoice_no=item.invoice_no,
                draft_text=text,
            )
        )
    return CollectionDraftResponse(
        drafts=drafts,
        draft_type=req.draft_type,
        model=model_used,
        count=len(drafts),
        dry_run=not use_llm,
    )


@app.post("/sales-doc", response_model=SalesDocResponse)
def sales_doc(req: SalesDocRequest) -> SalesDocResponse:
    """A6 Sales Doc Drafter: dokumen penjualan (SPH/offering/presentation/MOU)
    dari konteks deal.

    dry_run / tanpa OPENROUTER_API_KEY → template deterministik (siap review).
    """
    use_llm = not req.dry_run and bool(os.environ.get("OPENROUTER_API_KEY"))
    if use_llm:
        text, model_used, _, _ = chat(
            build_salesdoc_system(req.doc_type),
            build_salesdoc_user(req),
            max_tokens=3000,
            models=salesdoc_models(),
        )
    else:
        text, model_used = template_doc(req), "dry-run"
    return SalesDocResponse(
        doc_type=req.doc_type,
        title=doc_title(req),
        draft_text=text,
        model=model_used,
        dry_run=not use_llm,
    )


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    """A8 Sentiment & Entity Extraction: anotasi sentiment + entity per pesan.

    LLM (Haiku) per pesan, fallback rule-based bila gagal parse / tanpa key.
    """
    use_llm = not req.dry_run and bool(os.environ.get("OPENROUTER_API_KEY"))
    system = build_extract_system()
    annotations = []
    model_used = "dry-run"
    for m in req.messages:
        if use_llm:
            try:
                raw, model_used, _, _ = chat(
                    system,
                    f"Pesan dari {m.sender or 'anon'}:\n{m.body}",
                    max_tokens=400,
                    models=extract_models(),
                )
                annotations.append(parse_llm(m.id, raw))
                continue
            except Exception:
                # fallback rule-based untuk pesan ini
                pass
        annotations.append(rule_based(m))
    return ExtractResponse(
        annotations=annotations,
        model=model_used if use_llm else "dry-run",
        count=len(annotations),
        dry_run=not use_llm,
    )


@app.post("/executive-synthesis", response_model=ExecSynthesisResponse)
def executive_synthesis(req: ExecSynthesisRequest) -> ExecSynthesisResponse:
    """A10 Executive Synthesis: briefing eksekutif lintas-domain dari sinyal.

    dry_run / tanpa OPENROUTER_API_KEY → template deterministik dari sinyal.
    """
    use_llm = not req.dry_run and bool(os.environ.get("OPENROUTER_API_KEY"))
    if use_llm:
        text, model_used, _, _ = chat(
            build_exec_system(req.period_label),
            build_exec_user(req.signals),
            max_tokens=2500,
            models=exec_models(),
        )
    else:
        text, model_used = template_briefing(req.signals, req.period_label), "dry-run"
    return ExecSynthesisResponse(briefing=text, model=model_used, dry_run=not use_llm)
