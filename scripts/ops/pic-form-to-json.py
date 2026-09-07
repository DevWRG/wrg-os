#!/usr/bin/env python3
"""Ubah 6 workbook "Form Input PIC Divisi" jadi JSON siap-impor (migrasi 168).

KENAPA DUA LANGKAH (python -> JSON -> node -> DB), BUKAN LANGSUNG:
1. Repo ini PUBLIK. Isi form memuat nama karyawan (kolom Catatan di sheet
   'Daftar Posisi' menyebut orang per posisi), uraian job desc, KPI, dan
   struktur koordinasi internal. Tidak boleh masuk git. JSON hasil konversi
   WAJIB ditulis ke luar working tree — skrip ini menolak menulis ke dalamnya.
   Migrasi 053 pernah melanggar ini dan harus ditambal
   scripts/db/anonymize-employee-spine.sql; jangan diulang.
2. apps/api tidak punya dependensi pembaca xlsx, dan menambahkannya cuma untuk
   skrip ops sekali jalan tidak sepadan (belum lagi aturan pnpm
   minimumReleaseAge). openpyxl sudah ada di jalur python yang sama dengan
   services/ai.

CARA PAKAI:
    python3 scripts/ops/pic-form-to-json.py \
        ~/Library/CloudStorage/GoogleDrive-*/My\\ Drive/WRG-OS-PIC \
        --out ~/pic-form-import.json
    node scripts/ops/pic-form-import.mjs --file ~/pic-form-import.json          # pratinjau
    node scripts/ops/pic-form-import.mjs --file ~/pic-form-import.json --apply  # tulis

Skrip ini murni transformasi + audit: tidak menyentuh database sama sekali.

YANG DINORMALISASI DI SINI, DAN YANG SENGAJA TIDAK
  Di sini : frekuensi, kondisi/target level otomasi, perspektif BSC, dan
            klasifikasi lawan koordinasi (classifyRules). Semuanya punya
            himpunan nilai tertutup yang sudah disepakati di dropdown form
            atau di kode blueprint, jadi satu tempat di kode sudah cukup.
  DI DB   : ejaan kolom "PJ (A)" -> tabel `pj_alias`. Skrip ini HANYA meneruskan
            pj_raw; importer yang me-resolusi lewat tabel. Alasannya ejaan PJ
            akan terus bertambah tiap form direvisi, dan menambah alias harus
            bisa dilakukan dengan satu INSERT — bukan patch kode di dua tempat.
            (Pelajaran yang sama dengan brand_alias.)
  TIDAK   : kolom Level ('L2' / 'L1-L2' / 'Level 1' bercampur) dan kolom KPI
            (kalimat bebas, bukan metrik terstruktur). Belum ada daftar
            kanonik yang disahkan; mengarang satu di sini akan jadi sumber
            kebenaran bayangan.

NILAI YANG TIDAK BISA DINORMALISASI DITINGGAL NULL, TIDAK DITEBAK. Contoh nyata:
kolom "Kondisi Sekarang" berisi 'Accurate' — itu nama sistem, bukan level
otomasi. Memaksanya jadi 'Digitalisasi' atau 'Otomasi' adalah keputusan orang,
bukan keputusan skrip. Semua kejadian seperti itu dilaporkan di bagian
TEMUAN supaya bisa dibereskan di sumbernya.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl tidak ada. Pakai python3 yang sama dengan services/ai, atau: pip3 install openpyxl")

REPO_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", ".."))

# --- label divisi di form -> key di tabel `divisi` (migrasi 168) --------------
# Sheet 'Daftar Posisi' form Dito menulis "GA", sedangkan sheet referensi
# 'PIC & HOD' di semua form menulis "BD & GA". Dua-duanya divisi yang sama.
DIVISI_KEY = {
    "aftersales": "aftersales",
    "finance & supply chain": "finance_sc",
    "accounting & tax": "acctax",
    "accounting": "acctax",
    "sales area west & east": "sales_area",
    "business ivd & medical": "business_ivd",
    "ga": "bd_ga",
    "bd & ga": "bd_ga",
    "bd & ga (general affairs)": "bd_ga",
    "general affair": "bd_ga",
}

# --- classifyRules: disalin apa adanya dari DATA.classifyRules di ------------
# WRG-OS_Blueprint-Operasional.html. Urutan menentukan hasil (match pertama
# menang): 'HoD Finance & Supply Chain' kena aturan Finance dulu, sedangkan
# 'HOD' telanjang jatuh ke Leadership di dekat akhir. Sengaja TIDAK dirapikan —
# daftar ini sudah ditera terhadap 126 baris koordinasi yang sama, dan
# "memperbaiki"-nya akan menggeser hasil klasifikasi tanpa ada yang minta.
# Pola dengan spasi di ujung (' kol', ' tax', ' ga ') dicocokkan ke teks yang
# sudah dibungkus spasi, supaya tidak ikut kena di tengah kata.
CLASSIFY_RULES = [
    (["customer", "user / kol", "user/kol", " kol", "hemodialisa", "rs/klinik", "klinik", "pasien"], "Customer/User"),
    (["vendor", "dcm", "prinsipal", "principal", "distributor", "ekspedisi", "mep", "vendor ro"], "Vendor/Principal"),
    (["teknisi", "aftersales", "technical service", "pic ivd", "pic non-ivd", "admin teknisi"], "Aftersales"),
    (["accounting", "admin tax", " tax", "admin station"], "Accounting & Tax"),
    (["finance", "keuangan", "petty cash", "funding", "staff ar", "ar & cn", "ar &cn", "purchasing",
      "inventory", "shipping", "distribution", "supply chain", "gudang", "fakturis"], "Finance & SC"),
    (["business", "application", "product", "tender", "hod ivd", "hod business"], "Business IVD & Medical"),
    (["general affair", "admin ga", "it/ga", " ga ", "gas", "sri"], "BD & GA"),
    (["sales", "admin cabang", "adm cabang", "kirim tagih", "marketing"], "Sales"),
    (["direktur"], "Leadership"),
    (["hod"], "Leadership"),
    (["all divisi", "semua divisi"], "ALL"),
]

# label hasil classifyRules -> (dengan_key, dengan_grup)
CLASSIFY_TARGET = {
    "Aftersales": ("aftersales", "internal"),
    "Finance & SC": ("finance_sc", "internal"),
    "Accounting & Tax": ("acctax", "internal"),
    "Sales": ("sales_area", "internal"),
    "Business IVD & Medical": ("business_ivd", "internal"),
    "BD & GA": ("bd_ga", "internal"),
    "Customer/User": ("Customer/User", "external"),
    "Vendor/Principal": ("Vendor/Principal", "external"),
    "Leadership": ("Leadership", "external"),
    # 'ALL' bukan satu node — grup ditinggal NULL, bukan dipaksa internal.
    "ALL": ("ALL", None),
}

FREKUENSI = {
    "harian": "harian",
    "mingguan": "mingguan",
    "bulanan": "bulanan",
    "kuartalan": "kuartalan",
    "triwulanan": "kuartalan",
    # 'Tahunan' SENGAJA tidak dipetakan: CHECK di migrasi 168 belum punya bucket
    # tahunan, dan memasukkannya ke 'kuartalan' akan memalsukan frekuensi. Kalau
    # form nanti memakainya, dia akan muncul di TEMUAN — tambah bucket di
    # migrasi baru, jangan tambal di sini.
    "sesuai kejadian": "kejadian",
    "per kebutuhan": "kejadian",
    "by case": "kejadian",
    "sesuai kebutuhan": "kejadian",
}

LEVEL = {"manual": "Manual", "digitalisasi": "Digitalisasi", "otomasi": "Otomasi",
         "otomatisasi": "Otomasi", "ai": "AI", "ai analytics": "AI"}

PERSPEKTIF = {
    "keuangan": "fin",
    "pelanggan": "cust",
    "proses internal": "proc",
    "pembelajaran & pertumbuhan": "learn",
    "pembelajaran dan pertumbuhan": "learn",
    "pembelajaran": "learn",
}

SHEET_A, SHEET_B, SHEET_C = "A. Tugas & Target", "B. Bedah SOP", "C. Koordinasi"
SHEET_POS, SHEET_OKR, SHEET_PICHOD = "Daftar Posisi", "OKR Divisi", "PIC & HOD"


def clean(v) -> str:
    """Rapikan sel: buang NBSP/zero-width, rapatkan spasi ganda, strip.

    Spasi ganda itu bukan teori: 'Application  Product Specialist IVD & Medical'
    di sheet Daftar Posisi vs 'Application Product Specialist IVD & Medical' di
    sheet A adalah posisi yang sama dan HARUS ketemu satu sama lain.
    """
    if v is None:
        return ""
    s = str(v)
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("​", "").replace("﻿", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def as_int(v):
    s = clean(v)
    if not s:
        return None
    try:
        return int(float(s))  # sel Excel numerik terbaca '5.0'
    except ValueError:
        return None


def header_row(ws, needle: str):
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if needle in [clean(c) for c in row]:
            return i
    return None


def table(ws, needle: str, ncol: int):
    """Baris data setelah baris header, lebar tetap ncol (sel kosong = '')."""
    h = header_row(ws, needle)
    if not h:
        return []
    out = []
    for row in ws.iter_rows(min_row=h + 1, values_only=True):
        cells = [clean(c) for c in list(row)[:ncol]]
        while len(cells) < ncol:
            cells.append("")
        if any(cells):
            out.append(cells)
    return out


def label_cell(ws, prefix: str):
    """Ambil nilai di sebelah kanan sel berlabel 'Divisi:' / 'PIC:'.

    Sel berlabel lain dilewati. Ini bukan kehati-hatian teoretis: di form GA sel
    'Divisi:' dibiarkan KOSONG, dan tanpa penjagaan ini fungsi akan mengembalikan
    label tetangganya ('PIC:') sebagai kalau-kalau itu nama divisi — lalu seluruh
    file tersingkir diam-diam karena 'pic:' tidak ada di DIVISI_KEY.
    """
    for row in ws.iter_rows(values_only=True):
        cells = [clean(c) for c in row]
        for i, c in enumerate(cells):
            if c.lower().startswith(prefix.lower()):
                for nxt in cells[i + 1:]:
                    if nxt and not nxt.endswith(":"):
                        return nxt
                return ""   # label ada tapi nilainya kosong
    return ""


def classify(text: str):
    """Kembalikan (dengan_key, dengan_grup, label) atau (None,None,None)."""
    padded = " " + text.lower() + " "
    for keys, label in CLASSIFY_RULES:
        for k in keys:
            if k.startswith(" ") or k.endswith(" "):
                if k in padded:
                    return (*CLASSIFY_TARGET[label], label)
            elif k in padded:
                return (*CLASSIFY_TARGET[label], label)
    return (None, None, None)


def norm_level(raw: str, temuan: list, where: str):
    """Buang keterangan dalam kurung, lalu cocokkan ke 4 nilai resmi."""
    if not raw:
        return None
    base = re.sub(r"\s*\([^)]*\)\s*$", "", raw).strip()
    hit = LEVEL.get(base.lower())
    if hit is None:
        temuan.append({"jenis": "level_di_luar_dropdown", "nilai": raw, "lokasi": where})
    return hit


def norm_frekuensi(raw: str, temuan: list, where: str):
    if not raw:
        return None
    base = re.sub(r"\s*\([^)]*\)\s*", " ", raw).strip()
    # 'Harian/Mingguan' -> ambil komponen paling sering; 'Mingguan/Bulanan' -> mingguan
    first = re.split(r"[/,]", base)[0].strip().lower()
    hit = FREKUENSI.get(first) or FREKUENSI.get(base.lower())
    if hit is None:
        temuan.append({"jenis": "frekuensi_tak_dikenal", "nilai": raw, "lokasi": where})
    return hit


def norm_perspektif(raw: str, temuan: list, where: str):
    if not raw:
        return None
    hit = PERSPEKTIF.get(raw.lower().strip())
    if hit is None:
        temuan.append({"jenis": "perspektif_tak_dikenal", "nilai": raw, "lokasi": where})
    return hit


def parse_workbook(path: str, temuan: list):
    wb = openpyxl.load_workbook(path, data_only=True)
    fname = os.path.basename(path)
    need = [SHEET_POS, SHEET_A, SHEET_B, SHEET_C, SHEET_OKR]
    missing = [s for s in need if s not in wb.sheetnames]
    if missing:
        temuan.append({"jenis": "sheet_hilang", "nilai": ", ".join(missing), "lokasi": fname})
        return None

    divisi_label = label_cell(wb[SHEET_POS], "Divisi:")
    key = DIVISI_KEY.get(divisi_label.lower())
    if not key:
        temuan.append({"jenis": "divisi_tak_dikenal", "nilai": divisi_label, "lokasi": fname})
        return None

    pic = label_cell(wb[SHEET_POS], "PIC:")
    # HOD diambil dari sheet referensi 'PIC & HOD' (identik di semua file), BUKAN
    # dari sel 'PIC:' di sheet OKR — di form Aftersales sel itu diisi nama HOD
    # (Muhid), di form lain diisi nama PIC. Sel yang sama berarti dua hal beda,
    # jadi tidak bisa dipakai.
    hod = ""
    if SHEET_PICHOD in wb.sheetnames:
        for r in table(wb[SHEET_PICHOD], "Divisi", 5):
            if DIVISI_KEY.get(r[1].lower()) == key:
                hod = r[3]
                if not pic:
                    pic = r[2]
                break

    # ---- posisi: gabungan sheet 'Daftar Posisi' + posisi yang muncul di A/C ---
    posisi = {}   # nama -> record

    def touch(nama: str, sumber: str):
        if not nama:
            return None
        if nama not in posisi:
            posisi[nama] = {"nama": nama, "jumlah_orang": None, "level_raw": None,
                            "catatan": None, "seq": len(posisi), "_sumber": [sumber],
                            "tugas": [], "koordinasi": []}
        elif sumber not in posisi[nama]["_sumber"]:
            posisi[nama]["_sumber"].append(sumber)
        return posisi[nama]

    for r in table(wb[SHEET_POS], "Nama Posisi", 5):
        rec = touch(r[1], SHEET_POS)
        if rec:
            rec["jumlah_orang"] = as_int(r[2])
            rec["level_raw"] = r[3] or None
            rec["catatan"] = r[4] or None

    # ---- Tabel A ------------------------------------------------------------
    last = ""
    for i, r in enumerate(table(wb[SHEET_A], "Posisi", 7), 1):
        nama = r[0] or last
        last = nama
        rec = touch(nama, SHEET_A)
        if rec is None or not r[2]:
            continue
        where = f"{fname} · {SHEET_A} baris ~{i}"
        rec["tugas"].append({
            "uraian": r[2],
            "rules": r[3] or None,
            "frekuensi_raw": r[4] or None,
            "frekuensi": norm_frekuensi(r[4], temuan, where),
            "pj_raw": r[5] or None,        # pj_key diresolusi importer via pj_alias
            "kpi_target": r[6] or None,
            "level_raw": r[1] or None,
            "seq": len(rec["tugas"]),
        })
        if not r[6]:
            temuan.append({"jenis": "tugas_tanpa_kpi", "nilai": r[2][:70], "lokasi": where})
        if not r[5]:
            temuan.append({"jenis": "tugas_tanpa_pj", "nilai": r[2][:70], "lokasi": where})

    # ---- Tabel B ------------------------------------------------------------
    sops, last = {}, ""
    for i, r in enumerate(table(wb[SHEET_B], "SOP / Workflow", 5), 1):
        nama_sop = r[0] or last
        last = nama_sop
        if not nama_sop or not r[1]:
            continue
        where = f"{fname} · {SHEET_B} baris ~{i}"
        s = sops.setdefault(nama_sop, {"nama": nama_sop, "seq": len(sops), "langkah": []})
        s["langkah"].append({
            "seq": len(s["langkah"]),
            "langkah": r[1],
            "kondisi_raw": r[2] or None,
            "kondisi": norm_level(r[2], temuan, where + " (Kondisi Sekarang)"),
            "target_raw": r[3] or None,
            "target_level": norm_level(r[3], temuan, where + " (Target Level)"),
            "catatan": r[4] or None,
        })
        if not r[2]:
            temuan.append({"jenis": "langkah_tanpa_kondisi", "nilai": r[1][:70], "lokasi": where})
        if not r[3]:
            temuan.append({"jenis": "langkah_tanpa_target", "nilai": r[1][:70], "lokasi": where})

    # ---- Tabel C ------------------------------------------------------------
    last = ""
    for i, r in enumerate(table(wb[SHEET_C], "Koordinasi dengan", 4), 1):
        nama = r[0] or last
        last = nama
        rec = touch(nama, SHEET_C)
        if rec is None or not r[1]:
            continue
        where = f"{fname} · {SHEET_C} baris ~{i}"
        dk, dg, label = classify(r[1])
        if dk is None:
            temuan.append({"jenis": "koordinasi_tak_terklasifikasi", "nilai": r[1], "lokasi": where})
        rec["koordinasi"].append({
            "seq": len(rec["koordinasi"]),
            "dengan_raw": r[1],
            "dengan_key": dk,
            "dengan_grup": dg,
            "apa": r[2] or None,
            "pemicu": r[3] or None,
        })

    # ---- OKR Divisi ---------------------------------------------------------
    # DUA GAYA PENGISIAN yang harus sama-sama terbaca benar:
    #   Aftersales/Finance : Objective ditulis SEKALI, baris lanjutannya kosong.
    #   Accounting/GA      : Objective DIULANG verbatim di tiap baris KR.
    # Kalau baris kedua diperlakukan sebagai objective baru, Accounting & Tax
    # jadi 8 objective padahal aslinya 3 (dan GA 8 padahal 3) — objective-nya
    # tercacah sebanyak key result-nya. Karena itu objective di-dedup by TEKS
    # dalam satu divisi: teks identik = objective yang sama.
    okr, last_obj, by_text = [], None, {}
    for i, r in enumerate(table(wb[SHEET_OKR], "Objective (arah kualitatif)", 3), 1):
        where = f"{fname} · {SHEET_OKR} baris ~{i}"
        obj = r[0]
        if obj:
            if obj in by_text:
                last_obj = by_text[obj]
                if r[2] and last_obj["perspective_raw"] and r[2] != last_obj["perspective_raw"]:
                    temuan.append({"jenis": "perspektif_bentrok_satu_objective",
                                   "nilai": f"{obj[:50]}: {last_obj['perspective_raw']} vs {r[2]}",
                                   "lokasi": where})
            else:
                last_obj = {"objective": obj, "perspective_raw": r[2] or None,
                            "perspective": norm_perspektif(r[2], temuan, where),
                            "seq": len(okr), "kr": []}
                okr.append(last_obj)
                by_text[obj] = last_obj
        if r[1]:
            if last_obj is None:
                temuan.append({"jenis": "kr_tanpa_objective", "nilai": r[1][:70], "lokasi": where})
                continue
            # Satu sel = satu key result, TIDAK dipecah di ';'. Isinya sering
            # "100% x, 0% y; z >=80%" — memecahnya menghasilkan potongan yang
            # tidak berdiri sendiri. Blueprint HTML juga menghitung 1 sel = 1 KR.
            last_obj["kr"].append({"key_result": r[1], "seq": len(last_obj["kr"])})

    return {
        "divisi_key": key,
        "divisi_label": divisi_label,
        "pic_nama": pic or None,
        "hod_nama": hod or None,
        "file": fname,
        "posisi": list(posisi.values()),
        "sop": list(sops.values()),
        "okr": okr,
    }


def cari_posisi_kembar(divisis: list, temuan: list):
    """Laporkan nama posisi yang beda-tipis di divisi yang sama.

    SENGAJA HANYA MELAPOR, TIDAK MENYATUKAN. Contoh nyata di divisi Business
    IVD & Medical: 'Application Product Specialist IVD & Medical' (sheet A) vs
    'Application & Product Specialist IVD' (sheet C). Kelihatan orang yang sama,
    tapi menyatukannya otomatis akan menggabungkan dua simpul graf koordinasi
    atas dasar dugaan. Keputusannya milik PIC-nya, dan cara benarnya adalah
    membetulkan ejaan di xlsx lalu impor ulang.
    """
    def sig(s):
        return re.sub(r"[^a-z0-9]", "", s.lower())

    for d in divisis:
        seen = defaultdict(list)
        for p in d["posisi"]:
            seen[sig(p["nama"])[:18]].append(p["nama"])
        for _, names in seen.items():
            uniq = sorted(set(names))
            if len(uniq) > 1:
                temuan.append({"jenis": "posisi_diduga_kembar", "nilai": " ⟷ ".join(uniq),
                               "lokasi": f"{d['file']} · divisi {d['divisi_key']}"})


def main():
    ap = argparse.ArgumentParser(description="Form PIC Divisi (xlsx) -> JSON impor migrasi 168")
    ap.add_argument("dir", help="folder berisi 6 .xlsx (Drive: My Drive/WRG-OS-PIC)")
    ap.add_argument("--out", required=True, help="tujuan JSON — HARUS di luar repo")
    args = ap.parse_args()

    out = os.path.realpath(os.path.expanduser(args.out))
    if out.startswith(REPO_ROOT + os.sep):
        sys.exit(f"TOLAK: {out} ada di dalam repo publik. Tulis ke luar working tree, mis. ~/pic-form-import.json")

    src = os.path.expanduser(args.dir)
    files = sorted(f for f in os.listdir(src) if f.endswith(".xlsx") and not f.startswith("~$"))
    if not files:
        sys.exit(f"tidak ada .xlsx di {src}")

    temuan, divisis = [], []
    for f in files:
        d = parse_workbook(os.path.join(src, f), temuan)
        if d:
            divisis.append(d)

    cari_posisi_kembar(divisis, temuan)

    payload = {
        "sumber": "Form Input PIC Divisi — Google Drive My Drive/WRG-OS-PIC",
        "migrasi": "168_pic_form_spine.sql",
        "file": files,
        "divisi": divisis,
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    # ---- ringkasan ----------------------------------------------------------
    print(f"JSON  -> {out}  ({os.path.getsize(out):,} byte)\n")
    print(f"{'DIVISI':22s} {'POSISI':>6} {'TUGAS':>6} {'SOP':>5} {'LANGKAH':>8} {'KOORD':>6} {'OBJ':>4} {'KR':>4}")
    tot = Counter()
    for d in divisis:
        n_t = sum(len(p["tugas"]) for p in d["posisi"])
        n_k = sum(len(p["koordinasi"]) for p in d["posisi"])
        n_l = sum(len(s["langkah"]) for s in d["sop"])
        n_kr = sum(len(o["kr"]) for o in d["okr"])
        print(f"{d['divisi_key']:22s} {len(d['posisi']):6d} {n_t:6d} {len(d['sop']):5d} {n_l:8d} {n_k:6d} {len(d['okr']):4d} {n_kr:4d}")
        tot.update(posisi=len(d["posisi"]), tugas=n_t, sop=len(d["sop"]),
                   langkah=n_l, koord=n_k, obj=len(d["okr"]), kr=n_kr)
    print(f"{'TOTAL':22s} {tot['posisi']:6d} {tot['tugas']:6d} {tot['sop']:5d} "
          f"{tot['langkah']:8d} {tot['koord']:6d} {tot['obj']:4d} {tot['kr']:4d}")

    print("\n== TEMUAN (bolong / menyimpang dari dropdown) ==")
    by = Counter(t["jenis"] for t in temuan)
    if not by:
        print("   (tidak ada)")
    for jenis, n in by.most_common():
        print(f"   {n:5d}  {jenis}")
        # untuk temuan yang butuh keputusan orang, tampilkan nilainya
        if jenis in ("level_di_luar_dropdown", "frekuensi_tak_dikenal", "perspektif_tak_dikenal",
                     "koordinasi_tak_terklasifikasi", "posisi_diduga_kembar", "divisi_tak_dikenal",
                     "sheet_hilang", "kr_tanpa_objective"):
            for nilai, c in Counter(t["nilai"] for t in temuan if t["jenis"] == jenis).most_common(12):
                print(f"          {c:3d}× {nilai}")

    print("\n== distinct PJ (A) — diresolusi importer via tabel pj_alias ==")
    pjs = Counter(t["pj_raw"] for d in divisis for p in d["posisi"] for t in p["tugas"] if t["pj_raw"])
    for k, v in pjs.most_common():
        print(f"   {v:5d}  {k}")

    print("\nLangkah berikut:")
    print(f"  node scripts/ops/pic-form-import.mjs --file {out}           # pratinjau")
    print(f"  node scripts/ops/pic-form-import.mjs --file {out} --apply   # tulis")


if __name__ == "__main__":
    main()
