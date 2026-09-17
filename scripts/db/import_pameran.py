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
account_id dicocokkan di Python atas INTI nama (lihat blok pencocokan di bawah),
bukan trigram atas nama utuh — hanya kecocokan meyakinkan yg dipakai otomatis.

Pakai: python3 import_pameran.py --file /tmp/pameran.xlsx [--db wrg_os_dev] [--apply]
  default = DRY-RUN (txn + ROLLBACK, cuma laporan; TIDAK insert).

Alur dua langkah dgn CSV:
  1. --review-csv tinjauan.csv   → lembar tinjauan + ISIAN (kolom yg tak ada di
                                   sheet: coop_model, unit_price, bulan/tahun beli)
  2. (orang mengisi CSV)
  3. --confirmed-csv tinjauan.csv → nilai CSV MENANG atas turunan xlsx;
                                   account_id hanya dari baris ber-keputusan 'ya'.

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
    '350 - 450' → (teks, 350, '')  ← batas bawah; teks asli selalu disimpan utuh.

    WAJIB menerima sel MENTAH, bukan hasil str(). openpyxl mengembalikan angka
    sebagai float ('60' di sheet → 60.0), dan membuang non-digit dari '60.0'
    menghasilkan 600 — salah 10x tanpa suara. Sel numerik karena itu ditangani
    sebagai angka, dan jalur teks membuang bagian desimal lebih dulu.
    """
    if isinstance(v, bool):
        return "", "", ""
    if isinstance(v, (int, float)):
        n = int(v)
        return str(n), str(n), ""
    t = s(v)
    if not t:
        return "", "", ""
    m = re.search(r"\d[\d.,]*", t)
    num = ""
    if m:
        tok = m.group(0).rstrip(".,")
        tok = re.sub(r"[.,]\d{1,2}$", "", tok)   # buang desimal, sisakan bagian bulat
        num = re.sub(r"[^\d]", "", tok)
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


def cust_id(name):
    """Tiruan custId() apps/api/src/repo/deal.ts — jalur form selalu mengisinya,
    jadi baris hasil impor jangan beda sendiri."""
    t = re.sub(r"[^a-z0-9]+", "-", s(name).lower()).strip("-")[:50]
    return t or "unknown"


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

# Suntingan manusia (kalau ada), dikunci per nomor baris sheet. CSV tinjauan
# bukan cuma buat mencentang account_id — ia juga lembar isian untuk kolom yg
# memang tak ada di sheet pameran (harga, model kerjasama, bulan/tahun beli).
# Nilai di CSV MENANG atas turunan dari xlsx, jadi koreksi manual tidak tertimpa.
confirmed = {}
if args.confirmed_csv:
    # utf-8-sig + lewati baris 'sep=,' — CSV tinjauan sengaja ditulis ramah Excel
    with open(args.confirmed_csv, newline="", encoding="utf-8-sig") as f:
        baris_csv = f.readlines()
    if baris_csv and baris_csv[0].lower().startswith("sep="):
        baris_csv = baris_csv[1:]
    # Excel lokal menyimpan ulang CSV dgn ';' (dan membuang baris 'sep='), jadi
    # pemisah WAJIB dideteksi — memaksa ',' bikin seluruh baris terbaca satu kolom
    # dan tiap suntingan hilang tanpa error.
    kepala = baris_csv[0] if baris_csv else ""
    pemisah = ";" if kepala.count(";") > kepala.count(",") else ","
    for row in csv.DictReader(baris_csv, delimiter=pemisah):
        kunci = s(row.get("baris")) or s(row.get("facility_name"))
        if kunci:
            confirmed[kunci] = row
    if "facility_name" not in (csv.DictReader(baris_csv, delimiter=pemisah).fieldnames or []):
        sys.exit(f"ERROR: kolom 'facility_name' tak ketemu di {args.confirmed_csv} "
                 f"(pemisah terdeteksi '{pemisah}') — CSV-nya rusak/salah file?")

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

COLS = ["customer_id", "customer_name", "facility_name", "brand", "product", "product_category",
        "prospect_category", "instansi_type", "city", "province", "am_id", "pic_hod",
        "cabang", "coop_model", "qty_text", "qty_num", "qty_unit", "unit_price",
        "estimate_amount", "purchase_month", "purchase_year", "stage", "probability",
        "forecast_category", "notes", "account_id"]

# Kolom CSV tinjauan. ISIAN = kosong dari sheet, tunggu diisi orang (padanan
# field form Deal Baru yg tak punya sumber di file pameran).
REVIEW_EDIT = ["facility_name", "customer_name", "kota", "provinsi", "brand", "product",
               "product_category", "am_panggilan", "pic_hod", "cabang",
               "qty_num", "qty_unit", "notes"]
REVIEW_ISIAN = ["coop_model", "unit_price", "purchase_month", "purchase_year"]
REVIEW_COLS = (["baris"] + REVIEW_EDIT + REVIEW_ISIAN
               + ["kandidat_nama", "kandidat_id", "skor", "kota_cocok", "tipe_cocok",
                  "putusan_otomatis", "keputusan"])

COOP_MODELS = ("KSO", "BELI")   # migrasi 110 — 'Sale'/'SALE' sudah pensiun

rows_out, review_rows = [], []
rep = {"total": 0, "skip_tanpa_brand": 0, "per_am": Counter(), "kota_tak_ketemu": Counter(),
       "am_tak_ketemu": Counter(), "brand_tak_dikenal": Counter(), "per_instansi_type": Counter(),
       "qty_kosong": 0, "qty_tanpa_angka": 0, "per_pcat": Counter(), "pcat_asal": Counter(),
       "pcat_bentrok": [], "putusan": Counter(), "dari_konfirmasi": 0, "faskes_kembar": [],
       "isian_terisi": Counter(), "isian_ditolak": [], "am_disunting": 0,
       "dihapus_di_csv": [], "kandidat_dikosongkan": []}
kunci_terpakai = set()
katalog_by_id = {c["id"]: c["nama"] for c in katalog}
seen_account = {}
am_by_panggilan = {k: v[0] for k, v in am_map.items()}


def angka(v, desc, baris_no, bulat=False):
    """Isian manusia → angka. Nilai ngawur DITOLAK + dilaporkan, bukan didiamkan."""
    txt = s(v)
    if not txt:
        return ""
    t = re.sub(r"[^\d.-]", "", txt)
    if not t:   # ada isinya tapi tak ada angka sama sekali → laporkan, jangan buang diam-diam
        rep["isian_ditolak"].append(f"baris {baris_no}: {desc}='{txt}' bukan angka")
        return ""
    try:
        n = float(t)
    except ValueError:
        rep["isian_ditolak"].append(f"baris {baris_no}: {desc}='{s(v)}' bukan angka")
        return ""
    if bulat:
        return str(int(n))
    return str(int(n)) if n == int(n) else str(n)


for baris_no, r in enumerate(allrows[hi + 1:], start=hi + 2):
    if not r:
        continue
    mentah = lambda k: r[ix[k]] if ix[k] is not None and len(r) > ix[k] else None
    get = lambda k: s(mentah(k))
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
    am_panggilan = pic_hod = cabang = ""
    t = terr.get(norm_kota(kota_raw))
    if t:
        am_panggilan, pic_hod, cabang = t
        hit = am_map.get(am_panggilan.upper())
        if hit:
            cabang = cabang or hit[1]
            rep["per_am"][am_panggilan] += 1
    elif kota_raw:
        rep["kota_tak_ketemu"][kota_raw] += 1

    qty_text, qty_num, qty_unit = parse_qty(mentah("qty"))
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
    acc_id = kand["id"] if (kand and putusan == "AUTO") else ""

    # Baris yg ADA di xlsx tapi TIDAK ada di CSV konfirmasi = sengaja dihapus
    # orang (mis. dua baris faskes kembar digabung jadi satu). Tanpa aturan ini
    # baris itu tetap terimpor dgn nilai asli xlsx — penghapusannya sia-sia dan
    # duplikatnya balik lagi tanpa peringatan.
    if confirmed and str(baris_no) not in confirmed and fac not in confirmed:
        rep["dihapus_di_csv"].append(f"baris {baris_no}: {fac}")
        continue

    # nilai dasar dari sheet; bisa ditimpa suntingan CSV di bawah
    baris = {
        "baris": str(baris_no),
        "facility_name": fac, "customer_name": fac, "kota": kota_raw, "provinsi": get("prov"),
        "brand": brand, "product": get("type"), "product_category": pcat,
        "am_panggilan": am_panggilan, "pic_hod": pic_hod, "cabang": cabang,
        "qty_num": qty_num, "qty_unit": qty_unit,
        "notes": ("Alat existing: " + alat) if alat else "",
        "coop_model": "", "unit_price": "", "purchase_month": "", "purchase_year": "",
        "kandidat_nama": kand["nama"] if kand else "", "kandidat_id": kand["id"] if kand else "",
        "skor": f"{kand['sim']:.2f}" if kand else "",
        "kota_cocok": "ya" if (kand and kand["kota_ok"]) else "tidak",
        "tipe_cocok": "ya" if (kand and kand["fam_ok"]) else "tidak",
    }

    # ── suntingan manusia menang ──
    sunting = confirmed.get(str(baris_no)) or confirmed.get(fac)
    if sunting:
        kunci_terpakai.add(str(baris_no) if str(baris_no) in confirmed else fac)
        for k in REVIEW_EDIT + REVIEW_ISIAN:
            if k in sunting and s(sunting[k]) != "":
                baris[k] = s(sunting[k])
                if k in REVIEW_ISIAN:
                    rep["isian_terisi"][k] += 1
        if s(sunting.get("keputusan")).lower() in ("ya", "y", "yes", "1"):
            # Tautan sah hanya kalau ID DAN NAMA kandidat sama-sama ada, dan nama
            # itu masih cocok dgn katalog. Mengosongkan kolom nama adalah cara
            # orang menolak kandidat; kalau cuma ID yg dibaca, penolakan itu tak
            # terlihat dan deal nyangkut ke faskes SALAH ('RSUD Trenggalek' →
            # 'DINAS KESEHATAN PPKB KAB. TRENGGALEK').
            cid, cnama = s(sunting.get("kandidat_id")), s(sunting.get("kandidat_nama"))
            if cid and not cnama:
                acc_id, putusan = "", "KANDIDAT DIKOSONGKAN"
                rep["kandidat_dikosongkan"].append(f"baris {baris_no}: {fac} (id {cid} diabaikan)")
            elif not cid:
                acc_id, putusan = "", "TANPA KANDIDAT"
            elif katalog_by_id.get(cid) is None:
                acc_id, putusan = "", "DITOLAK"
                rep["isian_ditolak"].append(f"baris {baris_no}: kandidat_id {cid} tak ada di katalog")
            elif _words(katalog_by_id[cid]) != _words(cnama):
                acc_id, putusan = "", "DITOLAK"
                rep["isian_ditolak"].append(
                    f"baris {baris_no}: kandidat_id {cid} = '{katalog_by_id[cid]}' != kandidat_nama '{cnama}'")
            else:
                acc_id, putusan = cid, "DIKONFIRMASI"
                rep["dari_konfirmasi"] += 1
        else:
            acc_id, putusan = "", "DITOLAK"
        # AM boleh dialihkan lewat CSV
        if baris["am_panggilan"].upper() != am_panggilan.upper():
            rep["am_disunting"] += 1
        # validasi isian
        baris["unit_price"] = angka(baris["unit_price"], "unit_price", baris_no)
        baris["qty_num"] = angka(baris["qty_num"], "qty_num", baris_no)
        pm = angka(baris["purchase_month"], "purchase_month", baris_no, bulat=True)
        baris["purchase_month"] = pm if (pm and 1 <= int(pm) <= 12) else ""
        if pm and not baris["purchase_month"]:
            rep["isian_ditolak"].append(f"baris {baris_no}: purchase_month '{pm}' di luar 1-12")
        py = angka(baris["purchase_year"], "purchase_year", baris_no, bulat=True)
        baris["purchase_year"] = py if (py and 2000 <= int(py) <= 2099) else ""
        if py and not baris["purchase_year"]:
            rep["isian_ditolak"].append(f"baris {baris_no}: purchase_year '{py}' tak masuk akal")
        if baris["coop_model"] and baris["coop_model"].upper() not in COOP_MODELS:
            rep["isian_ditolak"].append(
                f"baris {baris_no}: coop_model '{baris['coop_model']}' bukan KSO/BELI")
            baris["coop_model"] = ""
        else:
            baris["coop_model"] = baris["coop_model"].upper()
        if baris["product_category"] and baris["product_category"] not in ("IVD", "Medical"):
            rep["isian_ditolak"].append(
                f"baris {baris_no}: product_category '{baris['product_category']}' bukan IVD/Medical")
            baris["product_category"] = ""

    rep["putusan"][putusan] += 1
    baris["putusan_otomatis"] = putusan
    baris["keputusan"] = "ya" if putusan in ("AUTO", "DIKONFIRMASI") else ""
    review_rows.append(baris)

    if acc_id:
        if acc_id in seen_account and seen_account[acc_id] != baris["facility_name"]:
            rep["faskes_kembar"].append(
                f"'{seen_account[acc_id]}' & '{baris['facility_name']}' → account_id {acc_id}")
        seen_account[acc_id] = baris["facility_name"]

    # am_panggilan (mungkin sudah disunting) → am_id
    am_final = am_by_panggilan.get(baris["am_panggilan"].upper(), "") if baris["am_panggilan"] else ""
    if baris["am_panggilan"] and not am_final:
        rep["am_tak_ketemu"][baris["am_panggilan"]] += 1

    est = ""
    if baris["qty_num"] and baris["unit_price"]:
        est = str(float(baris["qty_num"]) * float(baris["unit_price"]))

    rows_out.append({
        "customer_id": cust_id(baris["customer_name"]),
        "customer_name": baris["customer_name"], "facility_name": baris["facility_name"],
        "brand": baris["brand"], "product": baris["product"],
        "product_category": baris["product_category"], "account_id": acc_id,
        "prospect_category": PROSPECT_CATEGORY, "instansi_type": itype,
        "city": baris["kota"], "province": baris["provinsi"],
        "am_id": am_final, "pic_hod": baris["pic_hod"], "cabang": baris["cabang"],
        "coop_model": baris["coop_model"],
        "qty_text": qty_text, "qty_num": baris["qty_num"], "qty_unit": baris["qty_unit"],
        "unit_price": baris["unit_price"], "estimate_amount": est,
        "purchase_month": baris["purchase_month"], "purchase_year": baris["purchase_year"],
        "stage": STAGE, "probability": str(PROBABILITY), "forecast_category": FORECAST_CATEGORY,
        "notes": baris["notes"],
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
    customer_id, customer_name, facility_name, brand, product, product_category, prospect_category,
    instansi_type, city, province, am_id, pic_hod, cabang, coop_model, qty_text, qty_num,
    qty_unit, unit_price, estimate_amount, purchase_month, purchase_year,
    stage, probability, forecast_category, notes, account_id)
  SELECT {nz('customer_id')}, {nz('customer_name')}, {nz('facility_name')}, {nz('brand')}, {nz('product')},
    {nz('product_category')},
    {nz('prospect_category')}, {nz('instansi_type')}, {nz('city')}, {nz('province')},
    {nz('am_id')}, {nz('pic_hod')}, {nz('cabang')}, {nz('coop_model')},
    {nz('qty_text')}, {nz('qty_num')}::numeric, {nz('qty_unit')},
    {nz('unit_price')}::numeric, {nz('estimate_amount')}::numeric,
    {nz('purchase_month')}::smallint, {nz('purchase_year')}::smallint,
    s.stage::deal_stage, {nz('probability')}::numeric,
    {nz('forecast_category')}, {nz('notes')}, {nz('account_id')}::bigint
  FROM stg s
  WHERE NOT EXISTS (
    SELECT 1 FROM deal d
     WHERE d.facility_name = s.facility_name
       AND coalesce(d.brand,'') = coalesce(NULLIF(s.brand,''),'')
       AND coalesce(d.product,'') = coalesce(NULLIF(s.product,''),'')
       AND coalesce(d.am_id,'') = coalesce(NULLIF(s.am_id,''),''))
  RETURNING deal_id, facility_name, brand, account_id, am_id, estimate_amount, coop_model)
SELECT * FROM ins;
-- Jalur form menulis satu baris timeline tiap deal dibuat. Tanpa ini, deal
-- hasil impor tampil dgn timeline KOSONG di board — beda sendiri dari deal
-- buatan UI. changed_by sengaja 'import-pameran' supaya asal-usulnya kelihatan.
INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
SELECT deal_id, NULL, 'Prospecting', 'import-pameran', 'deal dibuat (impor pameran)'
FROM ins_log;
\\echo '--- LAPORAN DB (dalam txn) ---'
SELECT 'staging_baris  = ' || count(*) FROM stg;
SELECT 'ter-insert     = ' || count(*) FROM ins_log;
SELECT 'skip_duplikat  = ' || ((SELECT count(*) FROM stg) - (SELECT count(*) FROM ins_log));
SELECT 'am_id terisi   = ' || count(*) FILTER (WHERE am_id IS NOT NULL) || '/' || count(*) FROM ins_log;
SELECT 'account_id match = ' || count(*) FILTER (WHERE account_id IS NOT NULL) || '/' || count(*) FROM ins_log;
SELECT 'estimasi terisi  = ' || count(*) FILTER (WHERE estimate_amount IS NOT NULL) || '/' || count(*)
       || '  total Rp ' || coalesce(sum(estimate_amount),0)::bigint FROM ins_log;
SELECT 'coop_model terisi= ' || count(*) FILTER (WHERE coop_model IS NOT NULL) || '/' || count(*) FROM ins_log;
SELECT 'timeline dibuat  = ' || count(*) FROM spt_state_log l JOIN ins_log i USING (deal_id);
\\echo '--- BENTROK: faskes+brand sama sudah punya deal lain (cek sebelum apply) ---'
-- Kunci dedup (facility_name, brand, product, am_id) TIDAK menangkap ini karena
-- kolom product berbeda ('DN-X5' vs isi lama). Deteksi F9 dijalankan sbg laporan
-- saja — sengaja TIDAK di-enqueue ke hitl_queue, karena 26 dari baris ini memang
-- ditautkan ke accurate_customer atas keputusan manusia di CSV, jadi antreannya
-- cuma akan banjir oleh perkara yg sudah diputus.
SELECT '  ' || i.facility_name || ' [' || i.brand || ']  sudah ada deal: '
       || d.customer_name || ' / ' || d.brand || ' @ ' || d.stage
  FROM ins_log i
  JOIN deal d ON d.deal_id <> i.deal_id
   AND similarity(d.customer_name, i.facility_name) >= 0.72
   AND upper(regexp_replace(coalesce(d.brand,''),'[^A-Za-z0-9]','','g'))
     = upper(regexp_replace(coalesce(i.brand,''),'[^A-Za-z0-9]','','g'))
 ORDER BY 1;
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
if rep["isian_terisi"] or rep["am_disunting"]:
    print(f"  isian manual dari CSV         : {dict(rep['isian_terisi'])}"
          + (f" | AM dialihkan: {rep['am_disunting']}" if rep["am_disunting"] else ""))
for t in rep["isian_ditolak"]:
    print(f"    ! isian DITOLAK             : {t}")
yatim = [k for k in confirmed if k not in kunci_terpakai]
if yatim:
    # Kebalikan dari baris-dihapus: baris CSV tanpa padanan di xlsx tak punya
    # jalan masuk sama sekali, jadi ia harus bersuara — bukan lenyap diam-diam.
    print(f"  ! baris CSV tanpa padanan xlsx: {len(yatim)} → {yatim[:8]}")
if rep["kandidat_dikosongkan"]:
    print(f"  kandidat dikosongkan di CSV   : {len(rep['kandidat_dikosongkan'])} → account_id TIDAK diisi")
    for t in rep["kandidat_dikosongkan"]:
        print(f"      - {t}")
if rep["dihapus_di_csv"]:
    print(f"  dilewati (dihapus di CSV)     : {len(rep['dihapus_di_csv'])}")
    for t in rep["dihapus_di_csv"]:
        print(f"      - {t}")

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
