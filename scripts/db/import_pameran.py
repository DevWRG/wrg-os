#!/usr/bin/env python3
"""Importer prospek pameran (xlsx 7-kolom) → tabel `deal`.

Sumber: rekap prospek hasil pameran/seminar dgn kolom
  Provinsi | Kota/Kabupaten | Nama Instansi | Brand (merk) | Type |
  Keterangan Alat Existing | Jumlah Test

Beda dgn import_hs_s1.py: sheet TIDAK punya kolom Sales/Status. Karena itu
  - stage selalu 'Prospecting' (+ turunannya Cold / 0.10 / D - Omit),
  - am_id DIPETAKAN DARI WILAYAH: Kota/Kabupaten → master_territory.kota →
    am_panggilan → master_user.am_id (pic_hod & cabang ikut dari baris yg sama).

One-shot, idempoten (NOT EXISTS pada facility_name+brand+product+am_id).
account_id di-fuzzy-match ke accurate_customer (pg_trgm ≥0.7, di SQL).

Pakai: python3 import_pameran.py --file /tmp/pameran.xlsx [--db wrg_os_dev] [--apply]
  default = DRY-RUN (txn + ROLLBACK, cuma laporan; TIDAK insert).

CATATAN: master_territory KOSONG di wrg_os_dev — dry-run di dev akan melaporkan
0 AM ter-map. Validasi pemetaan wilayah butuh DB yg punya isi master_territory.
"""
import argparse, csv, subprocess, sys, re, tempfile, os
from collections import Counter
from openpyxl import load_workbook

# ── konstanta ──────────────────────────────────────────────────────────────
# Sheet pameran tak punya kolom Status → semua masuk tahap awal.
# HARUS sinkron dgn STAGE_META apps/api/src/repo/deal.ts + migrasi 069.
STAGE = "Prospecting"
PROSPECT_CATEGORY, PROBABILITY, FORECAST_CATEGORY = "Cold", 0.10, "D - Omit"

# product_category diturunkan dari Brand (klasifikasi resmi product_code →
# product_kategori: 01 IVD, 02 NON IVD) dgn kolom Type sbg penengah saat satu
# brand jual di dua kategori, atau sbg cadangan saat brand belum terdaftar.
TYPE_IVD_HINT = re.compile(
    r"(clia|fia|elisa|hplc|koagulasi|pt\s*/?\s*aptt|urin|hema|kimia|imuno|analy[sz]er|"
    r"reagen|rapid|strip|gluco|hba1c|blood gas|\bbga\b|\bhb\b|swab|kaset)", re.I)
TYPE_MEDICAL_HINT = re.compile(
    r"(\bbed\b|ranjang|kursi|linen|sterilisator|autoclave|lampu|troli|trolley|meja|"
    r"kasur|\busg\b|\be[ck]g\b|ventilator|infus|nebuli[sz]er|kantong darah)", re.I)


def s(v):  # cell → stripped str
    return "" if v is None else str(v).strip()


def norm_kota(v):
    """Kota/Kabupaten → kunci join ke master_territory.kota.

    Buang prefix administratif ('Kota Kediri' & 'Kabupaten Kediri' → 'kediri')
    dan seluruh tanda baca, supaya ejaan bebas di sheet tetap ketemu.
    """
    t = re.sub(r"[^a-z0-9 ]", " ", s(v).lower())
    t = re.sub(r"\s+", " ", t).strip()
    for p in ("kota ", "kabupaten ", "kab ", "kotamadya "):
        if t.startswith(p):
            t = t[len(p):]
    return t.strip()


def instansi_type(nama):
    """Turunkan jenis instansi dari namanya (kolom ini tak ada di sheet)."""
    n = s(nama).lower()
    if "puskesmas" in n:
        return "Puskesmas"
    if "dinas kesehatan" in n or "dinkes" in n:
        return "Dinkes"
    if n.startswith("rumah sakit") or re.search(r"\b(rs|rsu|rsd|rsud|rsup|rsi|rsm|rsau|rsab)\b", n):
        return "RS"
    if "klinik" in n:
        return "Klinik"
    if "laboratorium" in n or re.match(r"^lab\b", n):
        return "Lab"
    if re.search(r"\b(fk|fakultas|universitas)\b", n):
        return "Instansi"
    return ""


def parse_qty(v):
    """'>500' → (teks, 500, ''); '130 kantong' → (teks, 130, 'kantong');
    '350 - 450' → (teks, 350, '')  ← batas bawah; teks asli selalu disimpan utuh."""
    t = s(v)
    if not t:
        return "", "", ""
    nums = re.findall(r"\d[\d.,]*", t)
    num = re.sub(r"[^\d]", "", nums[0]) if nums else ""
    unit = re.sub(r"[\d.,>\-<~+/\s]+", " ", t).strip()
    unit = re.sub(r"\s+", " ", unit)
    return t, num, unit


def psql_rows(db, sql):
    out = subprocess.run(["psql", db, "-tAF|", "-c", sql], capture_output=True, text=True)
    if out.returncode != 0:
        sys.stderr.write(out.stderr)
        sys.exit(1)
    return [ln.split("|") for ln in out.stdout.strip().splitlines() if ln]


def load_territory(db):
    """kota_norm → (am_panggilan, hod_panggilan, cabang). Deteksi kota ambigu."""
    rows = psql_rows(db, "select am_panggilan, hod_panggilan, cabang, kota from master_territory")
    terr, ambigu = {}, {}
    for r in rows:
        if len(r) < 4:
            continue
        am, hod, cabang, kota = r[0], r[1], r[2], r[3]
        k = norm_kota(kota)
        if k in terr and terr[k][0] != am:
            ambigu.setdefault(k, {terr[k][0]}).add(am)
            continue  # kota dipegang >1 AM → jangan tebak, biarkan kosong
        terr.setdefault(k, (am, hod, cabang))
    for k in ambigu:
        terr.pop(k, None)
    return terr, ambigu


# ── pencocokan faskes → accurate_customer ──────────────────────────────────
# Accurate menulis nama TERBALIK: '<INTI>, <JENIS> <KOTA|KAB>. <TEMPAT>'
#   'KARANGKEMBANG, RSUD KAB. LAMONGAN'  ← file pameran: 'RSUD Karangkembang'
# Membandingkan string utuh bikin trigram jeblok (0.46) padahal faskesnya sama,
# sementara menurunkan ambang malah menarik faskes LAIN di kabupaten yg sama
# ('RSUD Trenggalek' vs 'PANGGUL, RSUD KAB. TRENGGALEK'). Karena itu yg
# dibandingkan adalah INTI nama saja, dgn kota + jenis faskes sbg penguat.
TYPE_FAMILY = {
    "RS": "RS", "RSU": "RS", "RSUD": "RS", "RSD": "RS", "RSUP": "RS", "RSI": "RS",
    "RSM": "RS", "RSAU": "RS", "RSAL": "RS", "RSJ": "RS", "RSB": "RS", "RSIA": "RS",
    "RUMAHSAKIT": "RS",
    "PKM": "PKM", "PUSKESMAS": "PKM",
    "LAB": "LAB", "LABORATORIUM": "LAB", "LABKES": "LAB",
    "KLINIK": "KLINIK", "KLN": "KLINIK",
}


def _words(t):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (t or "").lower())).strip()


def trigram_sim(a, b):
    """Tiruan pg_trgm.similarity: |irisan| / |gabungan| atas set trigram."""
    def grams(t):
        t = "  " + re.sub(r"\s+", " ", t.strip()) + " "
        return {t[i:i + 3] for i in range(len(t) - 2)}
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / len(ga | gb)


def split_accurate(nama):
    """'KARANGKEMBANG, RSUD KAB. LAMONGAN' → ('karangkembang','RS','RSUD','lamongan')."""
    if "," in nama:
        inti, sisa = nama.split(",", 1)
    else:
        inti, sisa = nama, ""
    sisa_w = _words(sisa).split()
    fam = tipe = ""
    if sisa_w:
        tipe = sisa_w[0].upper()
        fam = TYPE_FAMILY.get(tipe, "")
    kota = ""
    m = re.search(r"\b(kota|kab|kabupaten)\b\.?\s*(.+)$", _words(sisa))
    if m:
        kota = norm_kota(m.group(2))
    return _words(inti), fam, tipe, kota


def split_file(nama, kota_file):
    """'RSUD Karangkembang' → ('karangkembang', 'RS'). Kota di ekor nama dibuang
    supaya tak ikut dibandingkan ('RSM Ahmad Dahlan Kota Kediri' → 'ahmad dahlan')."""
    w = _words(nama)
    fam = tipe = ""
    tok = w.split()
    if tok and TYPE_FAMILY.get(tok[0].upper()):
        tipe = tok[0].upper()
        fam, tok = TYPE_FAMILY[tipe], tok[1:]
    elif w.startswith("rumah sakit"):
        fam, tipe, tok = "RS", "RS", tok[2:]
    elif tok and "puskesmas" in tok[0]:
        fam, tipe, tok = "PKM", "PUSKESMAS", tok[1:]
    inti = " ".join(tok)
    # buang 'kota <x>' / '<kota>' di ekor, tapi jangan sampai intinya habis
    kk = norm_kota(kota_file)
    if kk:
        sisa = re.sub(r"\b(kota|kab|kabupaten)?\s*" + re.escape(kk) + r"\s*$", "", inti).strip()
        if sisa:
            inti = sisa
    return inti, fam, tipe


def load_accurate_customers(db):
    rows = psql_rows(db, "select id, coalesce(nullif(name,''), raw->'customer'->>'name','') "
                         "from accurate_customer where coalesce(nullif(name,''), "
                         "raw->'customer'->>'name','') <> ''")
    out = []
    for r in rows:
        if len(r) >= 2:
            inti, fam, tipe, kota = split_accurate(r[1])
            out.append({"id": r[0], "nama": r[1], "inti": inti, "fam": fam,
                        "tipe": tipe, "kota": kota})
    return out


def match_faskes(nama, kota_file, katalog):
    """→ (kandidat_terbaik | None, putusan). putusan: AUTO / TINJAU / TOLAK.

    AUTO SELALU menuntut kota cocok — inti nama yg umum ('muhammadiyah') bisa
    identik lintas provinsi, jadi kemiripan tinggi saja tak cukup. Kalau inti
    nama tak lebih dari nama kotanya sendiri ('RSUD Jombang' → inti 'jombang'),
    tak ada pembeda selain jenis faskes, jadi jenisnya wajib sama PERSIS —
    kalau tidak, 'RSUD Jombang' bakal nyangkut ke 'JOMBANG, RSI KAB. JOMBANG'.
    """
    inti, fam, tipe = split_file(nama, kota_file)
    kk = norm_kota(kota_file)
    hambar = bool(inti) and inti == kk   # inti nama = nama kota → tak ada pembeda
    best = None
    for c in katalog:
        sim = trigram_sim(inti, c["inti"])
        kota_ok = bool(kk and c["kota"] and kk == c["kota"])
        fam_ok = (not fam or not c["fam"] or fam == c["fam"])
        tipe_ok = (not tipe or not c["tipe"] or tipe == c["tipe"])
        skor = sim + (0.15 if kota_ok else 0) + (0.05 if fam_ok else -0.20)
        if best is None or skor > best["skor"]:
            best = {**c, "sim": sim, "kota_ok": kota_ok, "fam_ok": fam_ok,
                    "tipe_ok": tipe_ok, "skor": skor}
    if not best:
        return None, "TOLAK"
    layak = best["kota_ok"] and best["fam_ok"] and (best["tipe_ok"] or not hambar)
    if layak and best["sim"] >= 0.55:
        return best, "AUTO"
    if best["sim"] >= 0.30 or best["kota_ok"]:
        return best, "TINJAU"
    return best, "TOLAK"


def load_am_map(db):
    """PANGGILAN (upper) → (am_id, cabang) dari master_user."""
    rows = psql_rows(db, "select upper(btrim(panggilan)), am_id, coalesce(cabang,'') "
                         "from master_user where coalesce(panggilan,'')<>''")
    return {r[0]: (r[1], r[2]) for r in rows if len(r) >= 3}


def load_brand_alias(db):
    """alias_key → canonical (alias_key = UPPER tanpa non-alnum)."""
    rows = psql_rows(db, "select alias_key, canonical from brand_alias")
    return {r[0]: r[1] for r in rows if len(r) >= 2}


def alias_key(v):
    return re.sub(r"[^A-Za-z0-9]", "", s(v)).upper()


def load_brand_category(db):
    """brand_key → {kategori: bobot}. Dua lapis:
      1. product_code + product_kategori — klasifikasi resmi, dipakai duluan.
      2. deal yg sudah ada — preseden utk brand yg belum terdaftar di product_code
         (mis. Ediagnosis). Hanya dipakai kalau lapis 1 tak punya brand-nya."""
    resmi, preseden = {}, {}
    for r in psql_rows(db, """
      select upper(regexp_replace(pc.brand,'[^A-Za-z0-9]','','g')),
             case k.nama when 'IVD' then 'IVD' when 'NON IVD' then 'Medical' else '' end,
             count(*)
        from product_code pc
        join product_kategori k on k.id = pc.kategori_id
       where coalesce(pc.brand,'') <> ''
       group by 1, 2"""):
        if len(r) >= 3 and r[1]:
            resmi.setdefault(r[0], {})[r[1]] = int(r[2])
    for r in psql_rows(db, """
      select upper(regexp_replace(brand,'[^A-Za-z0-9]','','g')), product_category, count(*)
        from deal
       where coalesce(brand,'') <> '' and product_category in ('IVD','Medical')
       group by 1, 2"""):
        if len(r) >= 3:
            preseden.setdefault(r[0], {})[r[1]] = int(r[2])
    for k, v in preseden.items():
        resmi.setdefault(k, v)
    return resmi


def product_category(brand, type_, brand_cat):
    """→ (kategori, asal_keputusan). Brand menang (itu klasifikasi resmi);
    Type cuma dipakai saat brand ambigu / tak terdaftar."""
    cats = brand_cat.get(alias_key(brand), {})
    ivd, med = bool(TYPE_IVD_HINT.search(type_ or "")), bool(TYPE_MEDICAL_HINT.search(type_ or ""))
    if len(cats) == 1:
        cat = next(iter(cats))
        bentrok = (cat == "IVD" and med and not ivd) or (cat == "Medical" and ivd and not med)
        return cat, ("brand (Type bentrok)" if bentrok else "brand")
    if len(cats) > 1:
        if ivd and not med:
            return "IVD", "Type (brand ambigu)"
        if med and not ivd:
            return "Medical", "Type (brand ambigu)"
        return max(cats.items(), key=lambda kv: kv[1])[0], "brand (mayoritas kode)"
    if ivd and not med:
        return "IVD", "Type (brand tak terdaftar)"
    if med and not ivd:
        return "Medical", "Type (brand tak terdaftar)"
    return "", "tak terderivasi"


# ── main ───────────────────────────────────────────────────────────────────
ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True)
ap.add_argument("--db", default="wrg_os_dev")
ap.add_argument("--sheet", default=None, help="nama sheet (default: sheet pertama)")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--review-csv", default=None,
                help="tulis CSV tinjauan pencocokan faskes ke path ini")
ap.add_argument("--confirmed-csv", default=None,
                help="baca CSV tinjauan yg sudah dicentang kolom keputusan (ya/tidak); "
                     "account_id HANYA diisi dari baris ber-keputusan 'ya'")
args = ap.parse_args()

terr, ambigu = load_territory(args.db)
am_map = load_am_map(args.db)
brand_alias = load_brand_alias(args.db)
brand_cat = load_brand_category(args.db)
katalog = load_accurate_customers(args.db)

# keputusan manusia (kalau ada): facility_name → account_id yg disetujui
confirmed = {}
if args.confirmed_csv:
    # utf-8-sig + lewati baris 'sep=,' — CSV tinjauan sengaja ditulis ramah Excel
    with open(args.confirmed_csv, newline="", encoding="utf-8-sig") as f:
        baris = f.readlines()
    if baris and baris[0].lower().startswith("sep="):
        baris = baris[1:]
    for row in csv.DictReader(baris):
        if s(row.get("keputusan")).lower() in ("ya", "y", "yes", "1"):
            confirmed[s(row.get("facility_name"))] = s(row.get("kandidat_id"))

wb = load_workbook(args.file, data_only=True)
ws = wb[args.sheet] if args.sheet else wb.worksheets[0]
allrows = [list(r) for r in ws.iter_rows(values_only=True)]
hi = next((i for i, r in enumerate(allrows)
           if r and any(s(c).lower() == "nama instansi" for c in r)), None)
if hi is None:
    sys.exit("ERROR: header 'Nama Instansi' tidak ketemu di sheet " + ws.title)
hdr = [s(c).lower() for c in allrows[hi]]


def col(*names):
    for n in names:
        if n in hdr:
            return hdr.index(n)
    return None


ix = {
    "prov": col("provinsi"),
    "kota": col("kota/kabupaten", "kota / kabupaten", "kota"),
    "fac": col("nama instansi"),
    "brand": col("brand (merk)", "brand"),
    "type": col("type", "tipe"),
    "alat": col("keterangan alat existing", "alat existing"),
    "qty": col("jumlah test", "jumlah tes"),
}
if ix["fac"] is None or ix["brand"] is None:
    sys.exit("ERROR: kolom wajib (Nama Instansi / Brand) tidak ketemu")

COLS = ["customer_name", "facility_name", "brand", "product", "product_category",
        "prospect_category", "instansi_type", "city", "province", "am_id", "pic_hod",
        "cabang", "qty_text", "qty_num", "qty_unit", "stage", "probability",
        "forecast_category", "notes", "account_id"]

REVIEW_COLS = ["facility_name", "kota", "brand", "kandidat_nama", "kandidat_id",
               "skor", "kota_cocok", "tipe_cocok", "putusan_otomatis", "keputusan"]

rows_out, review_rows = [], []
rep = {"total": 0, "skip_tanpa_brand": 0, "per_am": Counter(), "kota_tak_ketemu": Counter(),
       "am_tak_ketemu": Counter(), "brand_tak_dikenal": Counter(), "per_instansi_type": Counter(),
       "qty_kosong": 0, "qty_tanpa_angka": 0, "per_pcat": Counter(), "pcat_asal": Counter(),
       "pcat_bentrok": [], "putusan": Counter(), "dari_konfirmasi": 0, "faskes_kembar": []}
seen_account = {}

for r in allrows[hi + 1:]:
    if not r:
        continue
    get = lambda k: s(r[ix[k]]) if ix[k] is not None and len(r) > ix[k] else ""
    fac, brand = get("fac"), get("brand")
    if not fac:
        continue
    if not brand:
        rep["skip_tanpa_brand"] += 1
        continue
    rep["total"] += 1

    # brand → cek kenal/tidak (normalisasi sesungguhnya dilakukan trigger deal_brand_norm)
    if alias_key(brand) not in brand_alias:
        rep["brand_tak_dikenal"][brand] += 1

    # wilayah → AM
    kota_raw = get("kota")
    am_id = pic_hod = cabang = ""
    t = terr.get(norm_kota(kota_raw))
    if t:
        am_panggilan, pic_hod, cabang = t
        hit = am_map.get(am_panggilan.upper())
        if hit:
            am_id = hit[0]
            cabang = cabang or hit[1]
            rep["per_am"][am_panggilan] += 1
        else:
            rep["am_tak_ketemu"][am_panggilan] += 1
    elif kota_raw:
        rep["kota_tak_ketemu"][kota_raw] += 1

    qty_text, qty_num, qty_unit = parse_qty(get("qty"))
    if not qty_text:
        rep["qty_kosong"] += 1
    elif not qty_num:
        rep["qty_tanpa_angka"] += 1

    itype = instansi_type(fac)
    rep["per_instansi_type"][itype or "(tak terdeteksi)"] += 1
    alat = get("alat")

    pcat, pcat_asal = product_category(brand, get("type"), brand_cat)
    rep["per_pcat"][pcat or "(kosong)"] += 1
    rep["pcat_asal"][pcat_asal] += 1
    if "bentrok" in pcat_asal:
        rep["pcat_bentrok"].append(f"{fac} — {brand} / {get('type')} → {pcat}")

    # pencocokan faskes → account_id
    kand, putusan = match_faskes(fac, kota_raw, katalog)
    if fac in confirmed:
        acc_id, putusan = confirmed[fac], "DIKONFIRMASI"
        rep["dari_konfirmasi"] += 1
    else:
        acc_id = kand["id"] if (kand and putusan == "AUTO") else ""
    rep["putusan"][putusan] += 1
    if putusan != "AUTO" or args.review_csv:
        review_rows.append({
            "facility_name": fac, "kota": kota_raw, "brand": brand,
            "kandidat_nama": kand["nama"] if kand else "", "kandidat_id": kand["id"] if kand else "",
            "skor": f"{kand['sim']:.2f}" if kand else "",
            "kota_cocok": "ya" if (kand and kand["kota_ok"]) else "tidak",
            "tipe_cocok": "ya" if (kand and kand["fam_ok"]) else "tidak",
            "putusan_otomatis": putusan,
            "keputusan": "ya" if putusan in ("AUTO", "DIKONFIRMASI") else "",
        })
    if acc_id:
        if acc_id in seen_account and seen_account[acc_id] != fac:
            rep["faskes_kembar"].append(f"'{seen_account[acc_id]}' & '{fac}' → account_id {acc_id}")
        seen_account[acc_id] = fac

    rows_out.append({
        "customer_name": fac, "facility_name": fac, "brand": brand, "product": get("type"),
        "product_category": pcat, "account_id": acc_id,
        "prospect_category": PROSPECT_CATEGORY, "instansi_type": itype,
        "city": kota_raw, "province": get("prov"),
        "am_id": am_id, "pic_hod": pic_hod, "cabang": cabang,
        "qty_text": qty_text, "qty_num": qty_num, "qty_unit": qty_unit,
        "stage": STAGE, "probability": str(PROBABILITY), "forecast_category": FORECAST_CATEGORY,
        "notes": ("Alat existing: " + alat) if alat else "",
    })

# staging CSV
csv_path = tempfile.mktemp(suffix="_pameran.csv")
with open(csv_path, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader()
    for row in rows_out:
        w.writerow(row)

nz = lambda c: f"NULLIF(s.{c},'')"
sql = f"""
CREATE TEMP TABLE stg ({', '.join(c + ' TEXT' for c in COLS)});
\\copy stg FROM '{csv_path}' WITH (FORMAT csv, HEADER true)
CREATE TEMP TABLE ins_log AS
WITH ins AS (
  INSERT INTO deal (
    customer_name, facility_name, brand, product, product_category, prospect_category,
    instansi_type, city, province, am_id, pic_hod, cabang, qty_text, qty_num, qty_unit,
    stage, probability, forecast_category, notes, account_id)
  SELECT {nz('customer_name')}, {nz('facility_name')}, {nz('brand')}, {nz('product')},
    {nz('product_category')},
    {nz('prospect_category')}, {nz('instansi_type')}, {nz('city')}, {nz('province')},
    {nz('am_id')}, {nz('pic_hod')}, {nz('cabang')}, {nz('qty_text')}, {nz('qty_num')}::numeric,
    {nz('qty_unit')}, s.stage::deal_stage, {nz('probability')}::numeric,
    {nz('forecast_category')}, {nz('notes')}, {nz('account_id')}::bigint
  FROM stg s
  WHERE NOT EXISTS (
    SELECT 1 FROM deal d
     WHERE d.facility_name = s.facility_name
       AND coalesce(d.brand,'') = coalesce(NULLIF(s.brand,''),'')
       AND coalesce(d.product,'') = coalesce(NULLIF(s.product,''),'')
       AND coalesce(d.am_id,'') = coalesce(NULLIF(s.am_id,''),''))
  RETURNING deal_id, facility_name, account_id, am_id)
SELECT * FROM ins;
\\echo '--- LAPORAN DB (dalam txn) ---'
SELECT 'staging_baris  = ' || count(*) FROM stg;
SELECT 'ter-insert     = ' || count(*) FROM ins_log;
SELECT 'skip_duplikat  = ' || ((SELECT count(*) FROM stg) - (SELECT count(*) FROM ins_log));
SELECT 'am_id terisi   = ' || count(*) FILTER (WHERE am_id IS NOT NULL) || '/' || count(*) FROM ins_log;
SELECT 'account_id match = ' || count(*) FILTER (WHERE account_id IS NOT NULL) || '/' || count(*) FROM ins_log;
\\echo '--- faskes TANPA account_id (prospek baru) ---'
SELECT '  ' || facility_name FROM ins_log WHERE account_id IS NULL ORDER BY 1;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")

print(f"== Importer pameran ({'APPLY' if args.apply else 'DRY-RUN'}) → db={args.db} sheet={ws.title} ==")
print(f"  baris valid dibaca : {rep['total']}")
print(f"  skip (tanpa brand) : {rep['skip_tanpa_brand']}")
print(f"  stage             : {STAGE} ({PROSPECT_CATEGORY} / {PROBABILITY} / {FORECAST_CATEGORY})")
print(f"  sebaran AM        : {dict(rep['per_am'])}")
print(f"  kota TIDAK ketemu di master_territory : {dict(rep['kota_tak_ketemu']) or '-'}")
print(f"  AM territory tak ada di master_user   : {dict(rep['am_tak_ketemu']) or '-'}")
if ambigu:
    print(f"  kota AMBIGU (>1 AM, sengaja dikosongkan): { {k: sorted(v) for k, v in ambigu.items()} }")
print(f"  brand tak dikenal brand_alias : {dict(rep['brand_tak_dikenal']) or '-'}")
print(f"  instansi_type (derived)       : {dict(rep['per_instansi_type'])}")
print(f"  Jumlah Test: kosong={rep['qty_kosong']} | ada teks tanpa angka={rep['qty_tanpa_angka']}")
print(f"  product_category (derived)    : {dict(rep['per_pcat'])}")
print(f"    asal keputusan              : {dict(rep['pcat_asal'])}")
for b in rep["pcat_bentrok"]:
    print(f"    ! brand vs Type bentrok     : {b}")
print(f"  pencocokan faskes             : {dict(rep['putusan'])}"
      + (f" (dari CSV konfirmasi: {rep['dari_konfirmasi']})" if rep["dari_konfirmasi"] else ""))
for d in rep["faskes_kembar"]:
    print(f"    ! dua baris → satu faskes   : {d}")

if args.review_csv:
    # BOM + 'sep=,' supaya kolomnya tidak gepeng saat dibuka di Excel lokal
    with open(args.review_csv, "w", newline="", encoding="utf-8-sig") as f:
        f.write("sep=,\n")
        w = csv.DictWriter(f, fieldnames=REVIEW_COLS)
        w.writeheader()
        for row in sorted(review_rows, key=lambda r: (r["putusan_otomatis"], r["facility_name"])):
            w.writerow(row)
    print(f"  CSV tinjauan ditulis          : {args.review_csv} ({len(review_rows)} baris)")
    print(f"    → isi kolom 'keputusan' dgn ya/tidak, lalu jalankan ulang dgn --confirmed-csv")
print(f"  staging csv: {csv_path} ({len(rows_out)} baris)")
print("== DB (staging load + insert + report; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")

res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body, capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
os.unlink(csv_path)
