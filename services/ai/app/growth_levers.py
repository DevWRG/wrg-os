import json
import re
from typing import Any, Dict, List, Optional

# F76 View 4 — Growth Levers. Sintesis 3-5 lever aksi Direktur dari sinyal
# (stuck deals F1, red flags F76, AR>90, dormant) — diprioritas by impact ×
# urgency × ease. Template deterministik dipakai tanpa OPENROUTER_API_KEY.

from .executive import NAMA_PERUSAHAAN, rupiah


def build_levers_system(period_label: str) -> str:
    return (
        f"Kamu analis eksekutif {NAMA_PERUSAHAAN}, distributor alat kesehatan B2B. "
        "Dari sinyal yang diberikan, usulkan 3-5 GROWTH LEVER paling berdampak untuk "
        f"Direktur minggu ini (periode: {period_label}), diprioritaskan by "
        "(impact IDR × urgency × ease).\n"
        "Balas HANYA JSON valid, tanpa markdown, format:\n"
        '{"levers":[{"id":1,"title":"...","impact_idr":<number>,"owner":"<nama/peran>",'
        '"sla_days":<number>,"rationale":"..."}]}\n'
        "Aturan: title actionable & spesifik (sebut nama customer/HoD dari sinyal). "
        "impact_idr angka rupiah (0 bila non-moneter). Jangan mengarang angka yang "
        "tidak ada di sinyal. Bahasa Indonesia, ringkas."
    )


def build_levers_user(signals: Dict[str, Any]) -> str:
    return (
        "Sinyal terkini (JSON) dari platform WRG:\n\n"
        f"{json.dumps(signals, ensure_ascii=False, indent=2)}\n\n"
        "Usulkan growth levers-nya (JSON only)."
    )


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def template_levers(signals: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Levers deterministik (dry-run / tanpa LLM) dari sinyal."""
    levers: List[Dict[str, Any]] = []
    stuck = signals.get("stuck_deals", []) or []
    red = signals.get("red_flags", []) or []
    ar90 = _num(signals.get("ar_over_90", 0))
    dormant = signals.get("dormant", {}) or {}

    # 1) Stuck deal bernilai terbesar → percepat closing.
    if stuck:
        d = stuck[0]
        who = d.get("am_name") or d.get("am_id") or "AM terkait"
        levers.append({
            "id": len(levers) + 1,
            "title": f"Percepat closing {d.get('customer', 'deal')} — mandek "
                     f"{d.get('days_in_stage', '?')} hari di stage {d.get('stage', '?')}",
            "impact_idr": round(_num(d.get("estimate_amount", 0))),
            "owner": who, "sla_days": 3,
            "rationale": f"Deal stale bernilai {rupiah(d.get('estimate_amount', 0))} berisiko "
                         "hilang momentum; dorong keputusan.",
        })
    # 2) AR >90 hari → recovery.
    if ar90 > 0:
        levers.append({
            "id": len(levers) + 1,
            "title": f"Recovery AR >90 hari ({rupiah(ar90)})",
            "impact_idr": round(ar90), "owner": "Finance", "sla_days": 5,
            "rationale": "Piutang macet menekan arus kas; prioritaskan penagihan tertua.",
        })
    # 3) Red flag paling merah → intervensi HoD.
    if red:
        r = red[0]
        levers.append({
            "id": len(levers) + 1,
            "title": f"Atasi {r.get('metric', 'metric merah')} tim HoD {r.get('hod', '?')}",
            "impact_idr": 0, "owner": f"HoD {r.get('hod', '')}".strip(), "sla_days": 7,
            "rationale": f"Metric merah ({r.get('pct')}% dari target) perlu koreksi terarah.",
        })
    # 4) Win-back dormant.
    cnt = int(_num(dormant.get("count", 0)))
    if cnt > 0:
        levers.append({
            "id": len(levers) + 1,
            "title": f"Win-back {cnt} customer dormant (>60 hari)",
            "impact_idr": round(_num(dormant.get("value", 0))), "owner": "Sales", "sla_days": 14,
            "rationale": f"Potensi pemulihan {rupiah(dormant.get('value', 0))} dari customer tidur.",
        })
    return levers[:5]


def parse_levers(text: str) -> Optional[List[Dict[str, Any]]]:
    """Parse output LLM jadi list lever. Toleran markdown fence. None bila gagal."""
    if not text:
        return None
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE).strip()
    m = re.search(r"\{.*\}", s, flags=re.DOTALL)
    if m:
        s = m.group(0)
    try:
        obj = json.loads(s)
    except (json.JSONDecodeError, ValueError):
        return None
    raw = obj.get("levers") if isinstance(obj, dict) else obj
    if not isinstance(raw, list) or not raw:
        return None
    out: List[Dict[str, Any]] = []
    for i, lv in enumerate(raw):
        if not isinstance(lv, dict) or not lv.get("title"):
            continue
        out.append({
            "id": lv.get("id", i + 1),
            "title": str(lv.get("title")),
            "impact_idr": round(_num(lv.get("impact_idr", 0))),
            "owner": str(lv.get("owner", "") or "—"),
            "sla_days": int(_num(lv.get("sla_days", 0))),
            "rationale": str(lv.get("rationale", "") or ""),
        })
    return out[:5] or None
