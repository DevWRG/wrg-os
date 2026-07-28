#!/usr/bin/env python3
"""gen-outsource-features.py — generate daftar fitur OUTSOURCE-SAFE dari board Roadmap.

Sumber kebenaran = GitHub Project #2 "WRG-OS Roadmap" (blueprint). Script memfilter
hanya fitur yang BOLEH dikerjakan tim outsource — di luar domain terlarang
(Management/Manajerial, Infrastruktur, CRM, HR) — lalu menulis daftar ringkas ke
docs/OUTSOURCE-FEATURES.md.

SINKRONISASI: jalankan ulang tiap blueprint (board) berubah, supaya daftar outsource
selalu ikut. Item yang naik ke domain terlarang otomatis TIDAK muncul.

    python3 scripts/ops/gen-outsource-features.py

Butuh: gh CLI ter-auth dengan izin Projects (mis. PROJECTS_TOKEN). Read-only ke board.
Output docs/OUTSOURCE-FEATURES.md = AUTO-GENERATED, jangan diedit manual.
"""
import json, os, re, subprocess, sys, datetime
from collections import defaultdict

OWNER, PROJECT = "DevWRG", 2

# Domain (prefix board) yang BOLEH dikerjakan outsource. Untuk membuka domain lain
# (mis. FINANCE) — tambahkan prefix-nya di set ini lalu jalankan ulang.
ALLOW = {"AFTERSALES", "SHIPPING", "PURCHASING", "OPS"}

# Sengaja DITAHAN (default konservatif): FINANCE, ERP, DOC menyangkut uang/AR/integrasi.
# Restricted permanen (jangan pernah dibuka ke outsource): CRM, HR, HRIS, PEOPLE, GOV,
# CROSS, SALES, BUSINESS.

# Item spesifik yang tetap DIKECUALIKAN walau domainnya allow (infra/admin/managerial).
# F23=RFID/Cartridge Claim (per Direktur: tak perlu), F86=Monorepo (infra), F103=User Access, F104=Tunnel, F108=RACI, F111=GAIS builder,
# F114/115/117=infra ops, F9=master-data(customer), F11=approval engine.
EXCLUDE_F = {"F23", "F86", "F103", "F104", "F108", "F111", "F114", "F115", "F117", "F9", "F11"}

LABEL = {
    "PURCHASING": "🛒 Purchasing / Supply Chain",
    "AFTERSALES": "🔧 Aftersales / Teknis",
    "SHIPPING": "🚚 Shipping / Pengiriman",
    "OPS": "🏢 General Affairs / Operasional",
}


def fetch_items():
    r = subprocess.run(
        ["gh", "project", "item-list", str(PROJECT), "--owner", OWNER,
         "--format", "json", "--limit", "300"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit("gagal ambil board (cek gh auth + izin Projects):\n" + r.stderr[:400])
    return json.loads(r.stdout).get("items", [])


def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    items = fetch_items()
    groups = defaultdict(list)
    for it in items:
        title = it.get("title") or it.get("content", {}).get("title", "")
        m = re.match(r"\[([A-Z/ ]+)\]\s*(.*)", title)
        if not m:
            continue
        prefix, rest = m.group(1), m.group(2).strip()
        if prefix not in ALLOW:
            continue
        fm = re.match(r"(F\d+)\b[ .:\-]*", rest)
        if not fm:
            continue  # hanya fitur ber-F-number (assignable) yang masuk daftar
        fnum = fm.group(1)
        if fnum in EXCLUDE_F:
            continue
        desc = rest[fm.end():].strip() or rest
        groups[prefix].append((fnum, desc, it.get("status", "")))

    total = sum(len(v) for v in groups.values())
    out = []
    out.append("# Daftar Fitur — Outsource-Safe (auto-generated)\n")
    out.append("> ⚙️ **JANGAN edit manual.** File ini di-generate dari blueprint "
               "(board **WRG-OS Roadmap**) oleh `scripts/ops/gen-outsource-features.py`.")
    out.append("> Jalankan ulang tiap board berubah agar daftar tetap sinkron.\n")
    out.append(f"> **Filter:** hanya domain yang boleh dikerjakan outsource — "
               f"`{', '.join(sorted(ALLOW))}` (di luar Management/Infrastruktur/CRM/HR). "
               "Beberapa item infra/admin dikecualikan.\n")
    out.append(f"Total fitur outsource-safe: **{total}** · di-generate "
               f"{datetime.date.today().isoformat()}\n")
    for prefix in sorted(groups):
        out.append(f"\n## {LABEL.get(prefix, prefix)}\n")
        out.append("| F | Fitur | Status |")
        out.append("|---|---|---|")
        for fnum, rest, status in sorted(groups[prefix], key=lambda x: int(x[0][1:])):
            rest = rest.replace("|", "/")
            out.append(f"| {fnum} | {rest} | {status} |")
    out.append("\n---\n")
    out.append("Fitur di luar daftar ini (CRM, HR, Management, Infrastruktur, Finance, ERP) "
               "**bukan** untuk outsource. Direktur menugaskan F-number spesifik dari daftar ini.")

    dst = os.path.join(root, "docs", "OUTSOURCE-FEATURES.md")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    summary = ", ".join(f"{k}:{len(v)}" for k, v in sorted(groups.items()))
    print(f"✓ docs/OUTSOURCE-FEATURES.md — {total} fitur ({summary})")


if __name__ == "__main__":
    main()
