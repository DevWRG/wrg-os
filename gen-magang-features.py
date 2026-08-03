#!/usr/bin/env python3
"""gen-magang-features.py — sinkronisasi materi onboarding magang dari blueprint.

Sumber kebenaran = GitHub Project #2 "WRG-OS Roadmap" (blueprint). Sekali jalan,
script memfilter fitur yang BOLEH dikerjakan anak magang (di luar domain terlarang:
Management/Manajerial, Infrastruktur, CRM, HR) lalu MENYINKRONKAN tiga output di folder
Drive ini:

  1. MAGANG-FEATURES.md          — daftar markdown (+ kolom Role min)
  2. ../WRG-OS-Blueprint-Magang-Safe.html — blok fitur di blueprint (antara <!--OF:START-->..<!--OF:END-->)
  3. Onboarding-Magang.html      — salinan blueprint yang ikut ter-sinkron (halaman onboarding di folder ini)

Jadi tiap kamu update blueprint/board, cukup jalankan:

    python3 gen-magang-features.py

...maka md + blueprint HTML + halaman onboarding langsung konsisten. Item yang naik ke
domain terlarang otomatis TIDAK muncul.

Butuh: gh CLI ter-auth dengan izin Projects (mis. PROJECTS_TOKEN). Read-only ke board.
Output = AUTO-GENERATED. Jangan edit blok/berkas hasil generate secara manual.
"""
import json, os, re, subprocess, sys, datetime, shutil
from collections import defaultdict

OWNER, PROJECT = "DevWRG", 2

# Domain (prefix board) yang BOLEH dikerjakan magang. Buka domain lain (mis. FINANCE)
# dengan menambah prefix-nya ke set ini lalu jalankan ulang.
ALLOW = {"AFTERSALES", "SHIPPING", "PURCHASING", "OPS"}

# Restricted: FINANCE/ERP/DOC (uang/AR/integrasi) + CRM/HR/HRIS/PEOPLE/GOV/CROSS/SALES/BUSINESS.

# Item spesifik yang tetap DIKECUALIKAN walau domainnya allow (infra/admin/managerial).
# F23=RFID/Cartridge Claim, F43=Kurir Performance (per Direktur: tak perlu), F86=Monorepo(infra),
# F103=User Access, F104=Tunnel, F108=RACI, F111=GAIS builder, F114/115/117=infra ops,
# F9=master-data(customer), F11=approval engine.
EXCLUDE_F = {"F23", "F43", "F86", "F103", "F104", "F108", "F111", "F114", "F115", "F117", "F9", "F11"}

# Urutan tampil domain (biar konsisten dgn blueprint).
ORDER = ["AFTERSALES", "PURCHASING", "SHIPPING", "OPS"]
LABEL = {
    "AFTERSALES": ("🔧", "Aftersales / Teknis"),
    "PURCHASING": ("🛒", "Purchasing / Supply Chain"),
    "SHIPPING":   ("🚚", "Shipping / Pengiriman"),
    "OPS":        ("🏢", "General Affairs / Operasional"),
}

# Visibilitas per auth role — role MINIMUM yang boleh melihat fitur.
# Hierarki: Management ⊇ HOD ⊇ Karyawan. Default (tak terdaftar) = "Karyawan".
# approval/oversight → HOD; analitis lintas-divisi/exec → Management.
VISIBILITY = {
    "F35": "HOD", "F40": "HOD", "F51": "HOD", "F75": "HOD",
    "F41": "Management",
}

HERE = os.path.dirname(os.path.abspath(__file__))
MD_OUT = os.path.join(HERE, "MAGANG-FEATURES.md")
BLUEPRINT = os.path.join(HERE, "..", "WRG-OS-Blueprint-Magang-Safe.html")
ONBOARD_HTML = os.path.join(HERE, "Onboarding-Magang.html")
OF_START = "<!-- OF:START"
OF_END = "<!-- OF:END -->"


def clean(s):
    """Bersihkan anotasi internal dari judul board agar layak tampil ke magang."""
    s = re.sub(r"\s*★\s*TIER\s*\d+", "", s)                       # buang "★ TIER n"
    s = re.sub(r"\s*\([^)]*(GAP|governance|HoD)[^)]*\)", "", s, flags=re.I)  # anotasi internal
    return s.strip()


def fetch_items():
    r = subprocess.run(
        ["gh", "project", "item-list", str(PROJECT), "--owner", OWNER,
         "--format", "json", "--limit", "300"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit("gagal ambil board (cek gh auth + izin Projects):\n" + r.stderr[:400])
    return json.loads(r.stdout).get("items", [])


def collect():
    groups = defaultdict(list)
    for it in fetch_items():
        title = it.get("title") or it.get("content", {}).get("title", "")
        m = re.match(r"\[([A-Z/ ]+)\]\s*(.*)", title)
        if not m:
            continue
        prefix, rest = m.group(1), m.group(2).strip()
        if prefix not in ALLOW:
            continue
        fm = re.match(r"(F\d+)\b[ .:\-]*", rest)
        if not fm:
            continue  # hanya fitur ber-F-number (assignable)
        fnum = fm.group(1)
        if fnum in EXCLUDE_F:
            continue
        desc = clean(rest[fm.end():].strip() or rest)
        groups[prefix].append((fnum, desc, it.get("status", "")))
    for k in groups:
        groups[k].sort(key=lambda x: int(x[0][1:]))
    return groups


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def role_badge(fnum):
    role = VISIBILITY.get(fnum)
    if role == "HOD":
        return ' <span class="pill" style="background:var(--ambbg);color:var(--amb)">HOD+</span>'
    if role == "Management":
        return ' <span class="pill" style="background:var(--redbg);color:var(--red)">Mgmt</span>'
    return ""


def render_md(groups, total, today):
    out = ["# Daftar Fitur — Magang-Safe (auto-generated)\n"]
    out.append("> ⚙️ **JANGAN edit manual.** Di-generate dari blueprint (board **WRG-OS Roadmap**) "
               "oleh `gen-magang-features.py` (folder Drive ini).")
    out.append("> Jalankan ulang tiap board berubah agar daftar tetap sinkron.\n")
    out.append(f"> **Filter:** hanya domain yang boleh dikerjakan magang — "
               f"`{', '.join(sorted(ALLOW))}` (di luar Management/Infrastruktur/CRM/HR). "
               "Beberapa item infra/admin dikecualikan.\n")
    out.append(f"Total fitur magang-safe: **{total}** · di-generate {today}\n")
    out.append("**Role min** = auth role minimum yang boleh melihat fitur "
               "(hierarki: Management ⊇ HOD ⊇ Karyawan). Tanpa tanda = **Karyawan** (semua role).\n")
    for prefix in [p for p in ORDER if p in groups]:
        emoji, name = LABEL.get(prefix, ("", prefix))
        out.append(f"\n## {emoji} {name}\n")
        out.append("| F | Fitur | Role min | Status |")
        out.append("|---|---|---|---|")
        for fnum, desc, status in groups[prefix]:
            out.append(f"| {fnum} | {desc.replace('|', '/')} | {VISIBILITY.get(fnum, 'Karyawan')} | {status} |")
    out.append("\n---\n")
    out.append("Fitur di luar daftar ini (CRM, HR, Management, Infrastruktur, Finance, ERP) "
               "**bukan** untuk magang. Direktur menugaskan F-number spesifik dari daftar ini.")
    return "\n".join(out) + "\n"


def render_html_block(groups, total, today):
    """Blok fitur untuk blueprint (di antara marker OF:START..OF:END)."""
    L = []
    L.append(f'  <h2>Daftar fitur magang-safe <span class="pill g">{total}</span></h2>')
    L.append('  <div class="card">')
    L.append('    <p class="sub" style="margin:0 0 12px">Hasil filter otomatis dari blueprint '
             '(board Roadmap) ke domain non-terlarang. Direktur menugaskan F-number spesifik dari sini. '
             'Di luar daftar ini (CRM/HR/Management/Infra/Finance/ERP) <b>bukan</b> untukmu.'
             '<br><b>Role min</b> — siapa boleh lihat (hierarki Management ⊇ HOD ⊇ Karyawan): '
             'default <b>Karyawan</b> (semua role); badge <b>HOD+</b> / <b>Mgmt</b> = role minimum.</p>')
    L.append('    <div class="grid">')
    for prefix in [p for p in ORDER if p in groups]:
        emoji, name = LABEL.get(prefix, ("", prefix))
        L.append(f'      <div><h3>{emoji} {esc(name)}</h3><ul>')
        for fnum, desc, _ in groups[prefix]:
            L.append(f'        <li><b>{fnum}</b> {esc(desc)}{role_badge(fnum)}</li>')
        L.append('      </ul></div>')
    L.append('    </div>')
    L.append(f'    <p class="sub" style="margin:12px 0 0">Sinkron dari board via '
             f'<code>gen-magang-features.py</code> (folder <code>17-Onboarding-Magang/</code>) — '
             f'jalankan ulang tiap blueprint berubah. Di-generate {today}.</p>')
    L.append('  </div>')
    return "\n".join(L)


def inject_blueprint(block):
    with open(BLUEPRINT, encoding="utf-8") as f:
        html = f.read()
    si = html.find(OF_START)
    ei = html.find(OF_END)
    if si == -1 or ei == -1:
        sys.exit("marker OF:START/OF:END tak ditemukan di blueprint — cek berkas.")
    line_end = html.find("\n", si) + 1                 # simpan baris komentar START utuh
    new = html[:line_end] + block + "\n  " + html[ei:]
    with open(BLUEPRINT, "w", encoding="utf-8") as f:
        f.write(new)
    return new


def main():
    groups = collect()
    total = sum(len(v) for v in groups.values())
    today = datetime.date.today().isoformat()

    with open(MD_OUT, "w", encoding="utf-8") as f:
        f.write(render_md(groups, total, today))

    block = render_html_block(groups, total, today)
    updated = inject_blueprint(block)

    # Halaman onboarding di folder ini = salinan blueprint yang ikut sinkron.
    onboard = updated.replace(
        "<title>WRG-OS — Blueprint (Magang-Safe)</title>",
        "<title>WRG-OS — Onboarding &amp; Blueprint (Magang-Safe)</title>")
    with open(ONBOARD_HTML, "w", encoding="utf-8") as f:
        f.write(onboard)

    summary = ", ".join(f"{k}:{len(groups[k])}" for k in ORDER if k in groups)
    print(f"✓ sinkron {total} fitur ({summary})")
    print(f"  - MAGANG-FEATURES.md")
    print(f"  - ../WRG-OS-Blueprint-Magang-Safe.html (blok OF:START..OF:END)")
    print(f"  - Onboarding-Magang.html")


if __name__ == "__main__":
    main()
