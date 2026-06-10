from typing import List

from .schemas import ActivityRow

# Layer B Compression (port dari legacy/crm skills/wrg-daily SKILL.md):
# field shortening + enum compression + pipe packing. Tujuan: ~8000 token → ~640.

TUJUAN_ENUM = {
    "Kunjungan Fisik": "KF",
    "Telepon": "T",
    "WA": "WA",
    "Demo": "D",
    "Presentasi": "P",
    "Follow-up": "FU",
    "Instalasi": "I",
    "Pengiriman": "K",
    "Servis": "S",
    "Training": "TR",
    "Lainnya": "L",
}


def wrg_compress(rows: List[ActivityRow]) -> str:
    """Pack activity rows jadi format kompak per-area.

    Format baris: <nama>|c:<cust>|t:<tujuan_enum>|h:<hasil>|nx:<next>[|!]
    Suffix ! menandai aktivitas unmatched (di luar plan).
    """
    by_area: dict[str, List[ActivityRow]] = {}
    for r in rows:
        by_area.setdefault(r.area or "-", []).append(r)

    lines: List[str] = []
    for area in sorted(by_area):
        lines.append(f"[{area}]")
        for r in by_area[area]:
            t = TUJUAN_ENUM.get(r.tujuan or "", r.tujuan or "-")
            mark = "|!" if r.is_unmatched else ""
            lines.append(
                f"{r.nama}|c:{r.customer}|t:{t}|h:{r.hasil}|nx:{r.next_action}{mark}"
            )
    return "\n".join(lines)
