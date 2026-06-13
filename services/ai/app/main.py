import json
import os

from fastapi import FastAPI

from .collection import build_collection_system, build_collection_user, template_draft
from .compress import wrg_compress
from .executive import build_exec_system, build_exec_user, template_briefing
from .extract import build_extract_system, parse_llm, rule_based
from .openrouter import (
    chat,
    chat_or_fallback,
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
    CompetitorExtractRequest,
    CompetitorExtractResponse,
    CompetitorMention,
    DailySummaryRequest,
    DailySummaryResponse,
    DigestResponse,
    DraftedItem,
    ExecSynthesisRequest,
    ExecSynthesisResponse,
    ExtractRequest,
    ExtractResponse,
    LeaveDetectRequest,
    LeaveDetectResponse,
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

CRITICAL RULES:
- JANGAN mengarang nama, angka, atau fakta yg tidak ada di data input.
- Section 'Perhatian' HANYA pakai nama dari list NON_REPORTERS & NO_PLAN yg di-input.
  Kalau kedua list kosong, tulis '(semua wajib user sudah submit)'.
- Section 'Ijin' HANYA pakai nama dari list ON_LEAVE. Skip section ini kalau list kosong.
- Angka overview 'anggota aktif dari N tim wajib' pakai anggota_aktif & wajib_total dari STATS
  (wajib_total sudah exclude yg ijin hari ini).
- Per Area hanya sebut area/cabang yg muncul di DATA INPUT.

FORMAT OUTPUT WAJIB (plain text, JANGAN pakai markdown header ##):
📊 *Daily Summary — {hari}, {tanggal}*

*Overview*
• {anggota_aktif} dari {wajib_total} tim wajib aktif lapor
• {total_report} laporan masuk
• {matched}% sesuai plan, {unmatched} aktivitas di luar plan

*Per Area*
[untuk setiap area yg muncul di data: ringkasan 2-3 kalimat]

*Highlight*
[maks 3 poin penting hari ini — deal hot, prospek baru, warning]

*Perhatian*
[copy nama dari NON_REPORTERS & NO_PLAN list, jangan ngarang]

*Ijin*
[copy nama dari ON_LEAVE list. Skip section kalau kosong]

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
    no_plan = ", ".join(req.no_plan) or "(kosong)"
    non_reporters = ", ".join(req.non_reporters) or "(kosong)"
    on_leave = ", ".join(req.on_leave) or "(kosong)"
    user_msg = (
        "============================================\n"
        "DATA INPUT (compressed):\n"
        f"{compressed}\n\n"
        "STATS:\n"
        f"anggota_aktif={s.anggota_aktif} | wajib_total={s.wajib_total} | "
        f"total_report={s.total_report} | matched={s.matched} | "
        f"unmatched={s.unmatched} | anggota_plan={s.anggota_plan}\n\n"
        f"NO_PLAN (wajib tapi tidak submit plan hari ini):\n{no_plan}\n\n"
        f"NON_REPORTERS (sudah submit plan tapi belum report):\n{non_reporters}\n\n"
        f"ON_LEAVE (wajib tapi ijin/cuti hari ini — sudah di-exclude dari wajib_total):\n{on_leave}\n"
        "============================================"
    )
    system = DAILY_SYSTEM_PROMPT.replace("{hari}", req.hari).replace(
        "{tanggal}", req.tanggal
    )

    fallback = f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user_msg}"
    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return DailySummaryResponse(summary=fallback, model="dry-run", dry_run=True)

    text, model, tin, tout = chat_or_fallback(system, user_msg, fallback)
    return DailySummaryResponse(
        summary=text, model=model, tokens_in=tin, tokens_out=tout,
        dry_run=model == "dry-run-fallback",
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

    fallback = f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user}"
    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return RekapResponse(
            rekap=fallback, model="dry-run", grup_aktif=grup_aktif,
            jumlah_pesan=len(req.messages), dry_run=True,
        )

    text, model, tin, tout = chat_or_fallback(
        system, user, fallback, max_tokens=2000, models=rekap_models()
    )
    return RekapResponse(
        rekap=text,
        model=model,
        grup_aktif=grup_aktif,
        jumlah_pesan=len(req.messages),
        tokens_in=tin,
        tokens_out=tout,
        dry_run=model == "dry-run-fallback",
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

    fallback = f"[DRY RUN — tanpa LLM]\n\nSYSTEM:\n{system}\n\nUSER:\n{user}"
    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return ResumeResponse(
            resume=fallback, model="dry-run", jumlah_rekap=jumlah, dry_run=True,
        )

    text, model, tin, tout = chat_or_fallback(
        system, user, fallback, max_tokens=2500, models=resume_models()
    )
    return ResumeResponse(
        resume=text,
        model=model,
        jumlah_rekap=jumlah,
        tokens_in=tin,
        tokens_out=tout,
        dry_run=model == "dry-run-fallback",
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
        tmpl = template_draft(item, req.draft_type)
        if use_llm:
            text, model_used, _, _ = chat_or_fallback(
                system,
                build_collection_user(item),
                tmpl,
                max_tokens=600,
                models=collection_models(),
            )
        else:
            text = tmpl
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
    tmpl = template_doc(req)
    if use_llm:
        text, model_used, _, _ = chat_or_fallback(
            build_salesdoc_system(req.doc_type),
            build_salesdoc_user(req),
            tmpl,
            max_tokens=3000,
            models=salesdoc_models(),
        )
    else:
        text, model_used = tmpl, "dry-run"
    return SalesDocResponse(
        doc_type=req.doc_type,
        title=doc_title(req),
        draft_text=text,
        model=model_used,
        dry_run=not use_llm or model_used == "dry-run-fallback",
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
    tmpl = template_briefing(req.signals, req.period_label)
    if use_llm:
        text, model_used, _, _ = chat_or_fallback(
            build_exec_system(req.period_label),
            build_exec_user(req.signals),
            tmpl,
            max_tokens=2500,
            models=exec_models(),
        )
    else:
        text, model_used = tmpl, "dry-run"
    return ExecSynthesisResponse(
        briefing=text, model=model_used,
        dry_run=not use_llm or model_used == "dry-run-fallback",
    )


# === detect_leave: deteksi izin/sakit/cuti individual dari grup HRD ===
LEAVE_SYSTEM_PROMPT = """You parse a single WhatsApp message from an Indonesian company HR group and decide if it announces that a SPECIFIC employee will be ABSENT from work (izin/sakit/cuti).

CRITICAL: the word "izin"/"ijin" is usually just a POLITENESS particle in Indonesian business chat ("izin bertanya", "izin mengingatkan", "izin update", "mohon izin untuk...") — those are NOT leave. Only treat as leave when the message clearly says a named person will NOT come to work / tidak masuk kerja / tidak bisa masuk / sedang sakit / mengajukan cuti.

Also: ignore COMPANY-WIDE holiday announcements (libur nasional, Idul Adha, cuti bersama) — those are not individual leave. Ignore third-party mentions that are not a real absence.

The input gives "Pengirim" (sender display name) and "Pesan" (body). If the message is first-person ("saya tidak masuk"...) and no other name appears, the absent person IS the sender — use the sender name. If the body forwards/quotes someone or names a person ("pengajuan cuti mba Kolis"), use THAT person.

Message date (for resolving "hari ini"/"besok"): {msgdate}

Return STRICT JSON (no markdown):
{"is_leave": true|false, "nama": "name of the ABSENT employee, or null", "jenis": "ijin"|"sakit"|"cuti"|null, "start_date": "YYYY-MM-DD" or null, "end_date": "YYYY-MM-DD" or null, "confidence": 0.0-1.0}
Rules: end_date = start_date if single day. If date unclear, use message date. confidence < 0.6 if unsure. Output JSON only."""


@app.post("/detect-leave", response_model=LeaveDetectResponse)
def detect_leave(req: LeaveDetectRequest) -> LeaveDetectResponse:
    """Ekstrak pengumuman izin/sakit/cuti dari satu pesan grup HRD via LLM.

    dry_run / tanpa OPENROUTER_API_KEY → is_leave=False (tak bisa deteksi tanpa LLM).
    """
    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return LeaveDetectResponse(is_leave=False, model="dry-run", dry_run=True)
    system = LEAVE_SYSTEM_PROMPT.replace("{msgdate}", req.msgdate)
    user_msg = f"Pengirim: {req.sender or '?'}\nPesan:\n{req.body}"
    text, model, _, _ = chat_or_fallback(system, user_msg, "", max_tokens=500)
    if not text:
        return LeaveDetectResponse(is_leave=False, model=model, dry_run=model == "dry-run-fallback")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(ln for ln in cleaned.splitlines() if not ln.strip().startswith("```"))
    cleaned = cleaned.strip()
    if cleaned.lower().startswith("json"):
        cleaned = cleaned[4:].strip()
    try:
        d = json.loads(cleaned)
    except (ValueError, TypeError):
        return LeaveDetectResponse(is_leave=False, model=model, dry_run=model == "dry-run-fallback")
    jenis = (d.get("jenis") or "").lower() or None
    if jenis == "izin":
        jenis = "ijin"
    if jenis not in (None, "ijin", "sakit", "cuti"):
        jenis = "ijin"
    return LeaveDetectResponse(
        is_leave=bool(d.get("is_leave")),
        nama=(d.get("nama") or None),
        jenis=jenis,
        start_date=(d.get("start_date") or None),
        end_date=(d.get("end_date") or None),
        confidence=float(d.get("confidence") or 0.0),
        model=model,
        dry_run=model == "dry-run-fallback",
    )


# === extract_competitor: ekstrak sebutan kompetitor dari hasil kunjungan ===
COMPETITOR_SYSTEM_PROMPT = """You extract competitor intelligence from Indonesian sales-visit reports for a medical/lab equipment distributor (Wahana Lifeline).

Given a `hasil` (visit narrative), extract mentions of COMPETITOR vendors, products, and prices. A competitor is any OTHER vendor/PT/distributor or product brand the customer mentioned using, comparing, or buying from — NOT Wahana itself.

Return STRICT JSON array. Each item:
{"vendor": "PT name OR brand (e.g., PT Dexa, Mindray)", "produk": "specific product (e.g., HBA1C, Hematologi analyzer)", "produk_kategori": "Hematologi | Kimia Klinik | POCT | BMHP | BGA | Imunologi | Mikrobiologi | Alkes | Reagen | Other", "harga_text": "raw price text or null", "harga_numeric": numeric IDR value or null, "konteks": "short 1-sentence snippet (<=120 chars)"}

Rules:
- Output JSON array only — no preamble, no markdown fence.
- Empty array [] if no competitor mention.
- Skip generic "vendor lain" tanpa nama spesifik.
- Skip Wahana own brand (Family Dr, Lysun, Snibe Maglumi, Clover, Wahana, WGI).
- One row per distinct (vendor, produk) pair.
- harga_numeric: parse "50 ribu" -> 50000, "1.5 jt" -> 1500000. null if unclear."""


@app.post("/extract-competitor", response_model=CompetitorExtractResponse)
def extract_competitor(req: CompetitorExtractRequest) -> CompetitorExtractResponse:
    """Ekstrak sebutan kompetitor dari satu narasi hasil kunjungan via LLM.

    dry_run / tanpa OPENROUTER_API_KEY → mentions=[] (tak bisa ekstrak tanpa LLM).
    """
    if req.dry_run or not os.environ.get("OPENROUTER_API_KEY"):
        return CompetitorExtractResponse(mentions=[], model="dry-run", dry_run=True)
    user_msg = f"Customer: {req.customer or '?'}\nTanggal: {req.tanggal}\n\nHasil:\n{req.hasil}"
    text, model, _, _ = chat_or_fallback(COMPETITOR_SYSTEM_PROMPT, user_msg, "[]", max_tokens=2000)
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(ln for ln in cleaned.splitlines() if not ln.strip().startswith("```"))
    cleaned = cleaned.strip()
    if cleaned.lower().startswith("json"):
        cleaned = cleaned[4:].strip()
    try:
        arr = json.loads(cleaned)
        if not isinstance(arr, list):
            arr = []
    except (ValueError, TypeError):
        arr = []
    mentions = []
    for m in arr:
        if not isinstance(m, dict):
            continue
        hn = m.get("harga_numeric")
        try:
            hn = float(hn) if hn not in (None, "", "null") else None
        except (ValueError, TypeError):
            hn = None
        mentions.append(CompetitorMention(
            vendor=(m.get("vendor") or None), produk=(m.get("produk") or None),
            produk_kategori=(m.get("produk_kategori") or None),
            harga_text=(m.get("harga_text") or None), harga_numeric=hn,
            konteks=(m.get("konteks") or None),
        ))
    return CompetitorExtractResponse(mentions=mentions, model=model, dry_run=model == "dry-run-fallback")
