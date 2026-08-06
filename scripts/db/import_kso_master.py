#!/usr/bin/env python3
"""Importer master Simulator KSO — JSON → tabel `kso_*` (migrasi 074).

Sumber: aplikasi `github.com/info-WL707/runningcost-zybio`, file `lib/data.js`
(master hardcode di kode). File itu dikonversi sekali jadi JSON dan disimpan di
Drive `Projects/WRG-OS-Project/data/kso-master-<tanggal>.json` — TIDAK ikut di
repo, karena repo ini PUBLIC dan harga alat/reagen bukan data publik.

Bentuk JSON:
  { "analyzers": [...], "reagents": [...], "parameters": [...],
    "panel": { "cc": [...], "clia": { "SNIBE": [...], "WONDFO": [...] } } }

Idempoten. Kunci upsert: analyzer (kategori, kode) · reagen (analyzer, jenis,
kode) · parameter (grup, no) · panel (grup, nama). Baris yang hilang dari JSON
DIHAPUS, supaya DB persis mencerminkan file sumber (reagen yang ditarik dari
katalog tidak boleh tetap muncul di simulasi).

KENAPA ADA VALIDASI KODE DI BAWAH: kolom `kode` bukan label, dia yang mengikat
baris ke rumus di apps/web/src/lib/kso/formula.ts. Reagen dengan kode yang tidak
dikenal rumus = harganya tidak pernah ikut terhitung, dan layarnya tetap tampil
normal — salah diam-diam. Jadi importer menolaknya di depan.

Pakai:
  python3 import_kso_master.py --file <json> --db <wrg_os_dev|wrg_os_prod> [--apply]
  default = DRY-RUN (txn + ROLLBACK, cuma laporan; TIDAK menulis).
"""
import argparse, csv, json, os, subprocess, sys, tempfile
from collections import Counter

# ── Kontrak dengan formula.ts ───────────────────────────────────────────────
# Analyzer → kode reagen yang dipakai rumusnya. Sinkronkan berbarengan kalau
# formula.ts berubah; ini sengaja diduplikasi supaya perubahan sumber data yang
# tidak disertai perubahan rumus (atau sebaliknya) berhenti di importer.
BINDING = {
    ("HEMATO",  "Z3"):       {"lyse", "dil", "probe"},
    ("HEMATO",  "Z52"):      {"dn", "ld", "lb", "probe"},
    ("HEMATO",  "Z50"):      {"dn", "ld", "lb", "probe"},
    ("HEMATO",  "EXZ6000"):  {"dn", "ldi", "ldii", "lb", "probe"},
    ("HEMATO",  "EXZ8000"):  {"dn", "ld", "ln", "fd", "fn", "ls", "dr", "fr", "probe"},
    ("CC",      "EXC200"):   {"conc", "probe_d"},
    ("CC",      "EXC400"):   {"conc", "probe_d"},
    ("XM",      "LIBO"):     {"card", "liss"},
    ("XM",      "REDCEL"):   {"ahg", "liss"},
    ("CLIA",    "SNIBE"):    {"starter", "wash", "cuvette", "lightcheck", "tubing"},
    ("CLIA",    "WONDFO"):   {"wash", "iwash", "substrate", "cuvette"},
    ("HPLC",    "AH600PRO"): {"el1", "el2", "el3", "hws", "col", "flt"},
    ("ELEKTRO", "DNX6"):     {"qc1", "qc2", "qc3"},
    ("BG",      "PT1000"):   {"pt10_60", "pt10_120", "pt10_200", "qc123"},
}

# Kunci `meta` yang WAJIB ada, per analyzer. Tanpa ini layarnya render kosong
# (mis. crossmatch tanpa `methods` = tak ada metode yang bisa dipilih).
META_WAJIB = {
    ("HEMATO",  "Z3"):       {"diff"},
    ("HEMATO",  "Z52"):      {"diff"},
    ("HEMATO",  "Z50"):      {"diff"},
    ("HEMATO",  "EXZ6000"):  {"diff"},
    ("HEMATO",  "EXZ8000"):  {"diff", "testModes", "xnCtrlPl", "xrCtrlPl", "calPl"},
    ("XM",      "LIBO"):     {"methods"},
    ("XM",      "REDCEL"):   {"methods"},
    ("ELEKTRO", "DNX6"):     {"modes"},
    ("BG",      "PT1000"):   {"stability", "dMaint"},
}

A_COLS = ["kategori", "kode", "label", "brand", "default_capex", "default_capex_pl",
          "default_disc", "default_kso_bulan", "default_markup", "default_tests",
          "presets", "meta", "urutan"]
R_COLS = ["kategori", "analyzer", "kode", "jenis", "nama", "pack", "vol", "yield_test",
          "harga_dp", "harga_pl", "flags", "urutan"]
P_COLS = ["grup", "no", "nama", "panel", "pack", "tests_per_kit", "harga_dp", "harga_pl", "flags"]
N_COLS = ["grup", "nama", "urutan"]

ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="JSON master KSO (dari folder Drive)")
# Wajib disebut, TIDAK ada default — lihat catatan yang sama di import_pricebook.py:
# "berhasil" ke database yang salah adalah kegagalan yang paling tidak terasa.
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--izinkan-kode-asing", action="store_true",
                help="tetap import walau ada kode analyzer/reagen di luar kontrak formula.ts")
args = ap.parse_args()

with open(args.file, encoding="utf-8") as f:
    src = json.load(f)

rep = Counter()
masalah = []

# ── analyzer ────────────────────────────────────────────────────────────────
a_rows, a_key = [], {}
for i, a in enumerate(src.get("analyzers", []), start=1):
    key = (a["kategori"], a["kode"])
    if key in a_key:
        sys.exit(f"analyzer duplikat: {key}")
    a_key[key] = True
    if key not in BINDING:
        masalah.append(f"analyzer {key[0]}/{key[1]} tidak dikenal formula.ts")
    kurang = META_WAJIB.get(key, set()) - set(a.get("meta") or {})
    if kurang:
        masalah.append(f"analyzer {key[0]}/{key[1]} kehilangan meta {sorted(kurang)}")
    a_rows.append([
        a["kategori"], a["kode"], a["label"], a.get("brand") or "",
        a.get("default_capex") or 0, "" if a.get("default_capex_pl") is None else a["default_capex_pl"],
        a.get("default_disc") or 0, a.get("default_kso_bulan") or 0,
        a.get("default_markup") or 0, a.get("default_tests") or 0,
        json.dumps(a.get("presets") or []), json.dumps(a.get("meta") or {}), i * 10,
    ])
    rep[f"analyzer:{a['kategori']}"] += 1

# ── reagen ──────────────────────────────────────────────────────────────────
r_rows = []
terpakai = Counter()
for r in src.get("reagents", []):
    key = (r["kategori"], r["analyzer"])
    if key not in a_key:
        sys.exit(f"reagen {r['kode']!r} menunjuk analyzer yang tidak ada: {key}")
    # QC boleh tanpa satuan (dibeli per botol, masuk sebagai overhead run QC).
    if r["jenis"] != "qc" and r.get("vol") is None and r.get("yield_test") is None:
        sys.exit(f"reagen {key[1]}/{r['kode']}: vol dan yield_test dua-duanya kosong "
                 f"(harga tidak bisa dijadikan per-mL maupun per-test)")
    if key in BINDING and r["kode"] not in BINDING[key]:
        masalah.append(f"reagen {key[1]}/{r['kode']} di luar kontrak formula.ts")
    terpakai[key] += 1
    if r["kode"] in BINDING.get(key, set()):
        terpakai[(key, r["kode"])] += 1
    r_rows.append([
        r["kategori"], r["analyzer"], r["kode"], r["jenis"], r["nama"], r.get("pack") or "",
        "" if r.get("vol") is None else r["vol"],
        "" if r.get("yield_test") is None else r["yield_test"],
        "" if r.get("harga_dp") is None else r["harga_dp"],
        "" if r.get("harga_pl") is None else r["harga_pl"],
        json.dumps(r.get("flags") or {}), r.get("urutan") or 0,
    ])
    rep["reagen"] += 1

# Kebalikannya: rumus menunggu reagen yang ternyata tidak ada di JSON.
for key, kodes in BINDING.items():
    if key not in a_key:
        masalah.append(f"analyzer {key[0]}/{key[1]} ada di formula.ts tapi tidak ada di JSON")
        continue
    hilang = [k for k in sorted(kodes) if not terpakai.get((key, k))]
    if hilang:
        masalah.append(f"analyzer {key[0]}/{key[1]} kehilangan reagen {hilang} yang dipakai rumus")

# ── parameter ───────────────────────────────────────────────────────────────
p_rows, p_key = [], set()
for p in src.get("parameters", []):
    key = (p["grup"], int(p["no"]))
    if key in p_key:
        sys.exit(f"parameter duplikat: {key}")
    p_key.add(key)
    p_rows.append([
        p["grup"], p["no"], p["nama"], p.get("panel") or "", p.get("pack") or "",
        "" if p.get("tests_per_kit") is None else p["tests_per_kit"],
        "" if p.get("harga_dp") is None else p["harga_dp"],
        "" if p.get("harga_pl") is None else p["harga_pl"],
        json.dumps(p.get("flags") or {}),
    ])
    rep[f"parameter:{p['grup']}"] += 1

# ── panel ───────────────────────────────────────────────────────────────────
n_rows = []
pan = src.get("panel") or {}
for i, nama in enumerate(pan.get("cc") or [], start=1):
    n_rows.append(["CC", nama, i * 10])
for grup, daftar in (pan.get("clia") or {}).items():
    for i, nama in enumerate(daftar, start=1):
        n_rows.append([grup, nama, i * 10])
rep["panel"] = len(n_rows)

# Panel yang dipakai parameter tapi tidak terdaftar → tampil di urutan asal-asalan.
terdaftar = {(g, n) for g, n, _ in n_rows}
yatim = sorted({(p["grup"], p["panel"]) for p in src.get("parameters", [])
                if p.get("panel") and (p["grup"], p["panel"]) not in terdaftar})
for g, n in yatim:
    masalah.append(f"panel {g}/{n!r} dipakai parameter tapi tidak ada di daftar urutan")

# ── laporan pra-tulis ───────────────────────────────────────────────────────
print(f"== Simulator KSO importer ({'APPLY' if args.apply else 'DRY-RUN'}) → db={args.db} ==")
print(f"  sumber            : {src.get('sumber', '-')}")
print(f"  analyzer          : {len(a_rows)}  (" +
      " · ".join(f"{k.split(':')[1]}={v}" for k, v in sorted(rep.items()) if k.startswith("analyzer:")) + ")")
print(f"  reagen/consumable : {rep['reagen']}")
print(f"  parameter         : {len(p_rows)}  (" +
      " · ".join(f"{k.split(':')[1]}={v}" for k, v in sorted(rep.items()) if k.startswith("parameter:")) + ")")
print(f"  panel             : {rep['panel']}")

if masalah:
    print(f"  ⚠️  kontrak formula.ts: {len(masalah)} masalah")
    for m in masalah[:15]:
        print(f"       {m}")
    if len(masalah) > 15:
        print(f"       … {len(masalah) - 15} lagi")
    if not args.izinkan_kode_asing:
        sys.exit("DITOLAK: samakan JSON dengan formula.ts (atau jalankan ulang dengan --izinkan-kode-asing).")
else:
    print("  kontrak formula.ts: cocok (semua analyzer & reagen yang dipakai rumus ada, tanpa kode asing)")

# ── muat ke DB ──────────────────────────────────────────────────────────────
paths = {}
for nama, cols, rows in (("analyzer", A_COLS, a_rows), ("reagent", R_COLS, r_rows),
                         ("parameter", P_COLS, p_rows), ("panel", N_COLS, n_rows)):
    fd, path = tempfile.mkstemp(suffix=".csv", prefix=f"kso_{nama}_")
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    paths[nama] = path

nz = lambda t, c: f"NULLIF({t}.{c},'')"
sql = f"""
CREATE TEMP TABLE stg_a ({', '.join(c + ' TEXT' for c in A_COLS)});
CREATE TEMP TABLE stg_r ({', '.join(c + ' TEXT' for c in R_COLS)});
CREATE TEMP TABLE stg_p ({', '.join(c + ' TEXT' for c in P_COLS)});
CREATE TEMP TABLE stg_n ({', '.join(c + ' TEXT' for c in N_COLS)});
\\copy stg_a FROM '{paths['analyzer']}'  WITH (FORMAT csv, HEADER true)
\\copy stg_r FROM '{paths['reagent']}'   WITH (FORMAT csv, HEADER true)
\\copy stg_p FROM '{paths['parameter']}' WITH (FORMAT csv, HEADER true)
\\copy stg_n FROM '{paths['panel']}'     WITH (FORMAT csv, HEADER true)

INSERT INTO kso_analyzer (kategori, kode, label, brand, default_capex, default_capex_pl,
  default_disc, default_kso_bulan, default_markup, default_tests, presets, meta, urutan, updated_at)
SELECT s.kategori, s.kode, s.label, {nz('s', 'brand')}, s.default_capex::numeric,
  {nz('s', 'default_capex_pl')}::numeric, s.default_disc::numeric, s.default_kso_bulan::int,
  s.default_markup::numeric, s.default_tests::int, s.presets::jsonb, s.meta::jsonb,
  s.urutan::int, now()
FROM stg_a s
ON CONFLICT (kategori, kode) DO UPDATE SET
  label=EXCLUDED.label, brand=EXCLUDED.brand, default_capex=EXCLUDED.default_capex,
  default_capex_pl=EXCLUDED.default_capex_pl, default_disc=EXCLUDED.default_disc,
  default_kso_bulan=EXCLUDED.default_kso_bulan, default_markup=EXCLUDED.default_markup,
  default_tests=EXCLUDED.default_tests, presets=EXCLUDED.presets, meta=EXCLUDED.meta,
  urutan=EXCLUDED.urutan, aktif=true, updated_at=now();

INSERT INTO kso_reagent (analyzer_id, kode, jenis, nama, pack, vol, yield_test,
  harga_dp, harga_pl, flags, urutan, updated_at)
SELECT a.id, s.kode, s.jenis, s.nama, {nz('s', 'pack')}, {nz('s', 'vol')}::numeric,
  {nz('s', 'yield_test')}::int, {nz('s', 'harga_dp')}::numeric, {nz('s', 'harga_pl')}::numeric,
  s.flags::jsonb, s.urutan::int, now()
FROM stg_r s JOIN kso_analyzer a ON a.kategori = s.kategori AND a.kode = s.analyzer
ON CONFLICT (analyzer_id, jenis, kode) DO UPDATE SET
  nama=EXCLUDED.nama, pack=EXCLUDED.pack, vol=EXCLUDED.vol, yield_test=EXCLUDED.yield_test,
  harga_dp=EXCLUDED.harga_dp, harga_pl=EXCLUDED.harga_pl, flags=EXCLUDED.flags,
  urutan=EXCLUDED.urutan, updated_at=now();

INSERT INTO kso_parameter (grup, no, nama, panel, pack, tests_per_kit, harga_dp, harga_pl, flags, updated_at)
SELECT s.grup, s.no::int, s.nama, {nz('s', 'panel')}, {nz('s', 'pack')},
  {nz('s', 'tests_per_kit')}::int, {nz('s', 'harga_dp')}::numeric,
  {nz('s', 'harga_pl')}::numeric, s.flags::jsonb, now()
FROM stg_p s
ON CONFLICT (grup, no) DO UPDATE SET
  nama=EXCLUDED.nama, panel=EXCLUDED.panel, pack=EXCLUDED.pack,
  tests_per_kit=EXCLUDED.tests_per_kit, harga_dp=EXCLUDED.harga_dp,
  harga_pl=EXCLUDED.harga_pl, flags=EXCLUDED.flags, aktif=true, updated_at=now();

INSERT INTO kso_panel (grup, nama, urutan)
SELECT s.grup, s.nama, s.urutan::int FROM stg_n s
ON CONFLICT (grup, nama) DO UPDATE SET urutan=EXCLUDED.urutan;

-- Baris yang hilang dari JSON. Reagen ikut terhapus lewat CASCADE kalau
-- analyzer-nya yang hilang; DELETE reagen di bawah untuk kasus analyzer tetap
-- ada tapi satu reagennya ditarik.
DELETE FROM kso_reagent r USING kso_analyzer a
 WHERE r.analyzer_id = a.id
   AND NOT EXISTS (SELECT 1 FROM stg_r s
                   WHERE s.kategori = a.kategori AND s.analyzer = a.kode
                     AND s.jenis = r.jenis AND s.kode = r.kode);
DELETE FROM kso_analyzer a
 WHERE NOT EXISTS (SELECT 1 FROM stg_a s WHERE s.kategori = a.kategori AND s.kode = a.kode);
DELETE FROM kso_parameter p
 WHERE NOT EXISTS (SELECT 1 FROM stg_p s WHERE s.grup = p.grup AND s.no::int = p.no);
DELETE FROM kso_panel n
 WHERE NOT EXISTS (SELECT 1 FROM stg_n s WHERE s.grup = n.grup AND s.nama = n.nama);

\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'analyzer: ' || kategori || ' = ' || count(*) FROM kso_analyzer GROUP BY kategori ORDER BY 1;
SELECT 'reagen_total=' || count(*) FROM kso_reagent;
SELECT 'reagen_tanpa_harga=' || count(*) FROM kso_reagent WHERE harga_dp IS NULL;
SELECT 'parameter: ' || grup || ' = ' || count(*) FROM kso_parameter GROUP BY grup ORDER BY 1;
SELECT 'parameter_tanpa_harga=' || count(*) FROM kso_parameter WHERE harga_dp IS NULL;
SELECT 'panel_total=' || count(*) FROM kso_panel;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print("== DB (staging load + upsert + report; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body, capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
for p in paths.values():
    os.unlink(p)

print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database '{args.db}' ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
