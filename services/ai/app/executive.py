import json
from typing import Any, Dict

# A10 — Executive Synthesis. Mensintesis sinyal lintas-domain (pipeline, AR,
# HITL, sentimen, aktivitas agen) jadi briefing eksekutif untuk direktur
# (Pak Gilang). Template dry-run dipakai tanpa OPENROUTER_API_KEY.

NAMA_PERUSAHAAN = "PT Wahana Rizky Gumilang (WRG)"


def rupiah(n: Any) -> str:
    try:
        return f"Rp{int(round(float(n))):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "Rp0"


def build_exec_system(period_label: str) -> str:
    return (
        f"Kamu adalah analis eksekutif {NAMA_PERUSAHAAN}, distributor alat "
        "kesehatan B2B. Susun BRIEFING EKSEKUTIF Bahasa Indonesia untuk direktur "
        "(Pak Gilang) dari data sinyal yang diberikan.\n"
        f"Periode: {period_label}.\n"
        "Struktur wajib (gunakan heading):\n"
        "1. Ringkasan Eksekutif (2-3 kalimat kunci)\n"
        "2. Pipeline Penjualan (nilai, tahap, momentum)\n"
        "3. Piutang / AR (eksposur overdue & risiko)\n"
        "4. Perhatian & Tindak Lanjut (item HITL, anomali)\n"
        "5. Sentimen & Aktivitas Lapangan\n"
        "6. Rekomendasi (maks 3, actionable)\n"
        "Singkat, tajam, berbasis angka dari sinyal. Jangan mengarang angka yang "
        "tidak ada. Keluarkan HANYA isi briefing."
    )


def build_exec_user(signals: Dict[str, Any]) -> str:
    return (
        "Sinyal terkini (JSON) dari platform WRG:\n\n"
        f"{json.dumps(signals, ensure_ascii=False, indent=2)}\n\n"
        "Susun briefing eksekutifnya."
    )


def template_briefing(signals: Dict[str, Any], period_label: str) -> str:
    """Briefing deterministik (dry-run / tanpa LLM)."""
    pipe = signals.get("pipeline", {}) or {}
    deals = pipe.get("deals", {}) or {}
    ar = signals.get("ar", {}) or {}
    sentiment = signals.get("sentiment", {}) or {}
    hitl_by_agent = signals.get("hitl_by_agent", {}) or {}
    agent_activity = signals.get("agent_activity", {}) or {}

    ar_buckets = ar.get("buckets", []) or []
    overdue = [b for b in ar_buckets if b.get("bucket") != "current"]
    overdue_amount = sum(float(b.get("total", 0) or 0) for b in overdue)
    overdue_count = sum(int(b.get("count", 0) or 0) for b in overdue)
    hitl_total = sum(int(v or 0) for v in hitl_by_agent.values())

    lines = [
        f"BRIEFING EKSEKUTIF WRG — {period_label}",
        "",
        "1. Ringkasan Eksekutif",
        f"   Pipeline {deals.get('open', 0)} deal terbuka senilai "
        f"{rupiah(deals.get('open_value', 0))}; eksposur piutang overdue "
        f"{overdue_count} invoice ({rupiah(overdue_amount)}); "
        f"{hitl_total} item menunggu keputusan (HITL).",
        "",
        "2. Pipeline Penjualan",
        f"   Total {deals.get('total', 0)} deal — terbuka {deals.get('open', 0)}, "
        f"menang {deals.get('won', 0)}, kalah {deals.get('lost', 0)}. "
        f"Nilai total {rupiah(deals.get('total_value', 0))}.",
    ]
    by_stage = pipe.get("by_stage", []) or []
    if by_stage:
        top = ", ".join(f"{s.get('stage')}: {s.get('count')}" for s in by_stage[:5])
        lines.append(f"   Tahap teratas — {top}.")

    lines += [
        "",
        "3. Piutang / AR",
        f"   Overdue {overdue_count} invoice, total {rupiah(overdue_amount)}.",
    ]
    for b in overdue:
        lines.append(f"   • bucket {b.get('bucket')}: {b.get('count')} ({rupiah(b.get('total'))})")

    lines += ["", "4. Perhatian & Tindak Lanjut"]
    if hitl_by_agent:
        for agent, n in hitl_by_agent.items():
            lines.append(f"   • {agent}: {n} item HITL pending")
    else:
        lines.append("   • Tidak ada item HITL pending.")

    lines += [
        "",
        "5. Sentimen & Aktivitas Lapangan",
        f"   Sentimen pesan — positif {sentiment.get('positive', 0)}, "
        f"netral {sentiment.get('neutral', 0)}, negatif {sentiment.get('negative', 0)}.",
    ]
    if agent_activity:
        act = ", ".join(f"{a}: {n}" for a, n in agent_activity.items())
        lines.append(f"   Aktivitas agen (24j) — {act}.")

    lines += [
        "",
        "6. Rekomendasi",
        "   1) Prioritaskan penagihan invoice overdue tertua.",
        "   2) Selesaikan antrian HITL agar transisi pipeline tidak tertahan.",
        "   3) Tindak lanjuti deal tahap akhir untuk akselerasi closing.",
    ]
    return "\n".join(lines)
