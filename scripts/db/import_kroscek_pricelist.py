#!/usr/bin/env python3
"""Importer kroscek price list → `product_pricelist_setup` (migrasi 073).

Sumber: `Master_Kroscek_PriceList_H2_2026.xlsx` sheet **Sheet2** — hasil kroscek
manual antara file handover Direktur (PL H2-2026) dan Google Sheet
"3. PL Product Compilation". Yang dibawa Sheet2 dan belum ada di DB:
HPP, nama final, kemasan/satuan, dan klasifikasi (Product Line / Class / Sub Class).

Data TIDAK di-commit — repo ini PUBLIC, HPP bukan data publik. Export Sheet2 ke
CSV lalu tunjuk file-nya. Hanya stdlib (tanpa openpyxl) supaya bisa jalan di
mesin prod apa adanya — sama seperti import_pricebook.py.

Kunci baris: `Baris PL Direktur` MINUS 1 = product_pricelist.row_no. Baris 2 di
sheet Direktur = record pertama di CSV price book, jadi selisihnya tetap 1.
Verified 1031/1031 nyambung di H2-2026. Importer MENOLAK jalan kalau ada row_no
yang tidak ada di price book (periode salah / price book belum di-import).

Harga TIDAK pernah ditulis importer ini. `product_pricelist` (snapshot handover)
adalah satu-satunya pemilik kolom harga; di sini harga cuma DIBANDINGKAN — kalau
Sheet2 beda harga/diskon/nett dari snapshot, itu artinya sheet-nya sudah bergerak
dan harus lewat import_pricebook.py, bukan disusupkan dari sini. Beda = tolak
(kecuali --izinkan-harga-beda, yang tetap tidak menulis harga, cuma melanjutkan).

Margin juga tidak disimpan (lihat komentar migrasi 073) — kolom "Margin Baru"
hanya diverifikasi: round(hpp/(1-margin)) harus == price_list.

Klasifikasi di-resolve HIRARKIS, sama aturannya dengan import_product_classification.py:
  Lini → kategori (IVD → 'IVD', Alkes → 'NON IVD'), lalu Product Line & Class
  dicari DI DALAM kategorinya, Sub Class di dalam (kategori, class)-nya.
Baris yang tak ter-resolve TIDAK ditebak — masuk `product_code_review` supaya
diputuskan HoD Business, dan kolom klasifikasi yang sudah benar tetap disimpan
sebagian (mis. Class ketemu tapi Sub Class belum terdaftar).

Pakai:
  python3 import_kroscek_pricelist.py --file <Sheet2.csv> \\
      --db <wrg_os_dev|wrg_os_prod> [--periode H2-2026] [--apply]
  default = DRY-RUN (BEGIN … ROLLBACK; FK & CHECK tetap diuji sungguhan).
"""
import argparse, csv, os, subprocess, sys, tempfile
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP

# ── kolom Sheet2 yang dipakai (harus ada semua) ────────────────────────────
K_BARIS   = "Baris PL Direktur"
K_NO      = "No"
K_NAMA    = "NAMA FINAL (sesuaikan di sini)"
K_VARIAN  = "Varian / Ukuran"
K_KEM_C   = "Kemasan (Compilation)"
K_KEM_D   = "Kemasan (Direktur)"
K_SATUAN  = "Satuan"
K_LINI    = "Lini"
K_LINE    = "Product Line (Compilation)"
K_CLASS   = "Class"
K_SUB     = "Sub Class"
K_KODE    = "Kode Accurate"
K_HPP     = "HPP Compilation"
K_HARGA   = "HARGA FINAL (Direktur)"
K_DISKON  = "DISKON FINAL"
K_NETT    = "Nett Price Final"
K_MARGIN  = "Margin Baru"
WAJIB = [K_BARIS, K_NO, K_NAMA, K_LINI, K_LINE, K_CLASS, K_SUB, K_KODE,
         K_HPP, K_HARGA, K_DISKON, K_NETT, K_MARGIN, K_SATUAN, K_KEM_C, K_KEM_D, K_VARIAN]

# Lini di Sheet2 → NAMA kategori di master (072). Dipetakan lewat nama, bukan id
# hard-code: id kategori ada di DB dan bisa berubah, namanya yang stabil.
LINI_KATEGORI = {"IVD": "IVD", "Alkes": "NON IVD"}

# Label sumber di product_code_review. Konsisten setiap jalan — dipakai untuk
# menyegarkan antrean (baris yang sudah beres hilang sendiri).
SUMBER = "Master Kroscek PL H2-2026"

SETUP_COLS = ["periode", "row_no", "nama_final", "varian", "kemasan", "satuan", "hpp",
              "kategori_id", "line_id", "class_id", "sub_class_id", "product_kode",
              "kode_sumber", "kroscek_no"]

clean = lambda v: " ".join(str(v or "").split())   # rapatkan whitespace, bukan cuma strip
low = lambda v: clean(v).lower()
rnd = lambda v: v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV export Sheet2 (Master Kroscek)")
# Wajib disebut, tanpa default: menulis ke database yang salah adalah kegagalan
# yang paling gampang tidak disadari (sudah kejadian di importer price book).
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
ap.add_argument("--periode", default="H2-2026")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--izinkan-harga-beda", action="store_true",
                help="lanjut walau harga/diskon/nett Sheet2 beda dari snapshot price book")
ap.add_argument("--izinkan-selisih", action="store_true",
                help="lanjut walau ada baris yang hpp/(1-margin) tidak sama dengan price_list")
args = ap.parse_args()


def psql_baca(sql):
    res = subprocess.run(["psql", args.db, "-tAF", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        sys.exit(f"gagal membaca database '{args.db}'")
    return [l.split("\t") for l in res.stdout.splitlines() if l.strip()]


# ── 1. prasyarat DB ────────────────────────────────────────────────────────
if psql_baca("SELECT to_regclass('public.product_pricelist_setup') IS NOT NULL")[0][0] != "t":
    sys.exit(f"tabel product_pricelist_setup belum ada di '{args.db}' — jalankan migrasi 073 dulu "
             f"(infra/postgres/init/073_pricebook_setup.sql)")

# Snapshot price book periode ini = pemilik kolom harga.
pb = {}
for r in psql_baca(f"SELECT row_no, price_list, diskon_maks, harga_nett, coalesce(nama,''), "
                   f"coalesce(kode,'') FROM product_pricelist "
                   f"WHERE periode = '{args.periode}'"):
    pb[int(r[0])] = dict(price_list=Decimal(r[1]), diskon=Decimal(r[2]), nett=Decimal(r[3]),
                         nama=r[4], kode=r[5])
if not pb:
    sys.exit(f"price book periode '{args.periode}' kosong di '{args.db}' — import price book dulu "
             f"(scripts/db/import_pricebook.py), baru lapisan kroscek ini.")

# Master taxonomy — indeks resolusi hirarkis (nama, induk) → id.
KAT = {low(r[1]): r[0] for r in psql_baca("SELECT id, nama FROM product_kategori")}
LINE = {(low(r[2]), r[0]): r[1] for r in psql_baca("SELECT kategori_id, id, nama FROM product_line")}
CLASS = {(low(r[2]), r[0]): r[1] for r in psql_baca("SELECT kategori_id, id, nama FROM product_class")}
SUB = {(low(r[3]), r[0], r[1]): r[2]
       for r in psql_baca("SELECT kategori_id, class_id, id, nama FROM product_sub_class")}
if not KAT:
    sys.exit(f"master klasifikasi kosong di '{args.db}' — jalankan import_product_classification.py dulu")
for lini, nama_kat in LINI_KATEGORI.items():
    if low(nama_kat) not in KAT:
        sys.exit(f"kategori '{nama_kat}' (pasangan Lini '{lini}') tidak ada di master")

# Kode produk yang sudah terbit: kode baru + kode hasil generator sheet (legacy).
# Legacy bisa kembar (generator sheet sempat menerbitkan kode ganda) — yang kembar
# TIDAK dipakai memasangkan, dilaporkan saja.
KODE_BARU = {r[0] for r in psql_baca("SELECT kode FROM product_code")}
_leg = Counter()
LEGACY = {}
for r in psql_baca("SELECT kode_legacy, kode FROM product_code WHERE kode_legacy IS NOT NULL"):
    _leg[r[0]] += 1
    LEGACY[r[0]] = r[1]
LEGACY_KEMBAR = {k for k, n in _leg.items() if n > 1}

# ── 2. baca + validasi Sheet2 ──────────────────────────────────────────────
rows_out, review, lap = [], [], Counter()
harga_beda, salah_margin, dobel = [], [], []
seen = {}

with open(args.file, encoding="utf-8-sig", newline="") as f:
    rd = csv.DictReader(f)
    kurang = [h for h in WAJIB if h not in (rd.fieldnames or [])]
    if kurang:
        sys.exit(f"kolom Sheet2 hilang: {kurang}\nada: {rd.fieldnames}")

    for i, raw in enumerate(rd, start=2):        # i = nomor baris di sheet
        g = lambda k: clean(raw.get(k))
        if not g(K_NAMA) and not g(K_BARIS):
            continue
        try:
            row_no = int(Decimal(g(K_BARIS))) - 1   # baris 2 di sheet = record 1 di CSV
        except Exception:
            sys.exit(f"baris {i}: '{K_BARIS}' bukan angka ({g(K_BARIS)!r})")
        lap["total"] += 1

        if row_no in seen:
            dobel.append((row_no, seen[row_no], i))
            continue
        seen[row_no] = i
        if row_no not in pb:
            sys.exit(f"baris {i}: row_no {row_no} tidak ada di price book periode "
                     f"'{args.periode}' — periode salah, atau price book belum di-import ulang")

        snap = pb[row_no]
        # Harga cuma dibandingkan; importer ini tidak pernah menulis kolom harga.
        harga, diskon, nett = Decimal(g(K_HARGA)), Decimal(g(K_DISKON)), Decimal(g(K_NETT))
        if (harga, diskon, nett) != (snap["price_list"], snap["diskon"], snap["nett"]):
            harga_beda.append((i, g(K_NAMA)[:45], f"{harga}/{diskon}/{nett}",
                               f"{snap['price_list']}/{snap['diskon']}/{snap['nett']}"))

        hpp = g(K_HPP)
        if hpp:
            hpp_d = Decimal(hpp)
            if hpp_d <= 0:
                sys.exit(f"baris {i}: HPP <= 0 ({hpp_d}) — CHECK di DB akan menolak")
            # "Margin Baru" tidak disimpan, tapi wajib konsisten: kalau tidak, HPP
            # dan harga di sheet itu berasal dari dua produk yang berbeda.
            mg = g(K_MARGIN)
            if mg:
                m = Decimal(mg)
                if not (0 <= m < 1):
                    salah_margin.append((i, g(K_NAMA)[:45], f"margin {m} di luar [0,1)"))
                elif rnd(hpp_d / (1 - m)) != rnd(harga):
                    salah_margin.append((i, g(K_NAMA)[:45],
                                         f"hpp/(1-margin)={rnd(hpp_d / (1 - m))} vs harga {rnd(harga)}"))
            hpp_out = f"{hpp_d:.2f}"
            lap["ada_hpp"] += 1
        else:
            hpp_out = ""
            lap["tanpa_hpp"] += 1

        # ── resolusi klasifikasi (hirarkis, tanpa tebakan) ──
        lini = g(K_LINI)
        kid = KAT.get(low(LINI_KATEGORI.get(lini, "")))
        pid = cid = sid = None
        masalah = None
        if not kid:
            masalah = f"Lini '{lini}' tidak dikenal (harus {'/'.join(LINI_KATEGORI)})"
        else:
            pid = LINE.get((low(g(K_LINE)), kid))
            cid = CLASS.get((low(g(K_CLASS)), kid))
            sid = SUB.get((low(g(K_SUB)), kid, cid)) if cid else None
            if not g(K_LINE) and not g(K_CLASS) and not g(K_SUB):
                masalah = "Baris tanpa data klasifikasi di Sheet2 (kolom Product Line/Class/Sub Class kosong)"
                lap["blocked_kosong"] += 1
            elif not pid:
                masalah = f"Product Line '{g(K_LINE)}' tidak terdaftar di kategori {kid} ({lini})"
                lap["blocked_line"] += 1
            elif not cid:
                masalah = f"Class '{g(K_CLASS)}' tidak terdaftar di kategori {kid} ({lini})"
                lap["blocked_class"] += 1
            elif not sid:
                masalah = f"Sub Class '{g(K_SUB)}' tidak terdaftar di Class {cid} ('{g(K_CLASS)}') kategori {kid}"
                lap["blocked_sub_class"] += 1
            else:
                lap["klasifikasi_lengkap"] += 1

        # ── pasangan ke kode produk (lewat kode saja, bukan nama) ──
        kode_src = g(K_KODE)
        product_kode = ""
        if kode_src:
            if kode_src in KODE_BARU:
                product_kode = kode_src
                lap["kode_cocok_baru"] += 1
            elif kode_src in LEGACY_KEMBAR:
                lap["kode_legacy_kembar"] += 1      # ambigu → tidak dipasangkan
            elif kode_src in LEGACY:
                product_kode = LEGACY[kode_src]
                lap["kode_cocok_legacy"] += 1
            else:
                lap["kode_tak_ketemu"] += 1
        else:
            lap["tanpa_kode"] += 1

        rows_out.append([args.periode, str(row_no), g(K_NAMA), g(K_VARIAN),
                         g(K_KEM_C) or g(K_KEM_D), g(K_SATUAN), hpp_out,
                         kid or "", pid or "", cid or "", sid or "",
                         product_kode, kode_src, g(K_NO)])
        if masalah:
            review.append(dict(baris=g(K_NO) or str(i), nama=g(K_NAMA), brand=clean(raw.get("Brand")),
                               kemasan=g(K_KEM_C) or g(K_KEM_D), satuan=g(K_SATUAN),
                               kode_legacy=kode_src, kat=lini, line=g(K_LINE),
                               klas=g(K_CLASS), sub=g(K_SUB), masalah=masalah))

# ── 3. laporan + gerbang ───────────────────────────────────────────────────
print(f"== Importer kroscek price list ({'APPLY' if args.apply else 'DRY-RUN'}) → "
      f"db={args.db} periode={args.periode} ==")
print(f"  baris Sheet2      : {lap['total']}   (price book di DB: {len(pb)})")
print(f"  HPP               : ada {lap['ada_hpp']} · kosong {lap['tanpa_hpp']}")
print(f"  klasifikasi 4 lvl : {lap['klasifikasi_lengkap']}")
print(f"  DITAHAN (review)  : {len(review)}  (tanpa data {lap['blocked_kosong']} · "
      f"line {lap['blocked_line']} · class {lap['blocked_class']} · sub class {lap['blocked_sub_class']})")
print(f"  pasangan kode     : lewat kode baru {lap['kode_cocok_baru']} · "
      f"lewat kode_legacy {lap['kode_cocok_legacy']} · "
      f"tak ketemu {lap['kode_tak_ketemu']} · legacy kembar (ambigu) {lap['kode_legacy_kembar']} · "
      f"Sheet2 tanpa kode {lap['tanpa_kode']}")
if review:
    print("    contoh yang butuh keputusan HoD Business:")
    for d in review[:5]:
        print(f"       baris {d['baris']}: {d['nama'][:45]} — {d['masalah']}")

if dobel:
    print(f"  ⚠️  row_no dobel di Sheet2: {len(dobel)} — dua baris menunjuk baris PL Direktur yang sama")
    for rn, a, b in dobel[:5]:
        print(f"       row_no {rn}: baris sheet {a} & {b} (yang kedua diabaikan)")
    sys.exit("row_no wajib unik — perbaiki kolom 'Baris PL Direktur' di Sheet2 dulu.")

if harga_beda:
    print(f"  ⚠️  harga/diskon/nett BEDA dari snapshot price book: {len(harga_beda)} baris")
    for i, nama, sheet, snap in harga_beda[:5]:
        print(f"       baris {i} {nama}: sheet {sheet} vs DB {snap}")
    if not args.izinkan_harga_beda:
        sys.exit("Sheet2 sudah bergerak dari price book. Harga milik product_pricelist — "
                 "import ulang lewat scripts/db/import_pricebook.py, ATAU pakai "
                 "--izinkan-harga-beda kalau memang cuma HPP/klasifikasi yang mau dimasukkan.")

if salah_margin:
    print(f"  ⚠️  margin tidak konsisten: {len(salah_margin)} baris")
    for i, nama, ket in salah_margin[:5]:
        print(f"       baris {i} {nama}: {ket}")
    if not args.izinkan_selisih:
        sys.exit("hpp/(1-margin) != harga → HPP dan harga di baris itu kemungkinan beda produk. "
                 "Perbaiki sheet, atau pakai --izinkan-selisih.")

if not rows_out:
    sys.exit("tidak ada baris terbaca — cek argumen --file")

# ── 4. muat ke DB ──────────────────────────────────────────────────────────
tmp = {}


def tulis(nama, header, rows):
    fd, path = tempfile.mkstemp(suffix=".csv", prefix=f"kroscek_{nama}_")
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    tmp[nama] = path
    return path


tulis("setup", SETUP_COLS, rows_out)
tulis("review", ["sumber", "sumber_baris", "nama", "brand", "kemasan", "satuan", "kode_legacy",
                 "kategori_nama", "line_nama", "class_nama", "sub_class_nama", "masalah"],
      [[SUMBER, d["baris"], d["nama"], d["brand"], d["kemasan"], d["satuan"], d["kode_legacy"],
        d["kat"], d["line"], d["klas"], d["sub"], d["masalah"]] for d in review])

nz = lambda c: f"NULLIF(s.{c},'')"
sql = f"""
CREATE TEMP TABLE stg_setup (periode TEXT, row_no TEXT, nama_final TEXT, varian TEXT,
  kemasan TEXT, satuan TEXT, hpp TEXT, kategori_id TEXT, line_id TEXT, class_id TEXT,
  sub_class_id TEXT, product_kode TEXT, kode_sumber TEXT, kroscek_no TEXT);
CREATE TEMP TABLE stg_review (sumber TEXT, sumber_baris TEXT, nama TEXT, brand TEXT,
  kemasan TEXT, satuan TEXT, kode_legacy TEXT, kategori_nama TEXT, line_nama TEXT,
  class_nama TEXT, sub_class_nama TEXT, masalah TEXT);

\\copy stg_setup  FROM '{tmp['setup']}'  WITH (FORMAT csv, HEADER true)
\\copy stg_review FROM '{tmp['review']}' WITH (FORMAT csv, HEADER true)

INSERT INTO product_pricelist_setup (periode, row_no, nama_final, varian, kemasan, satuan,
  hpp, kategori_id, line_id, class_id, sub_class_id, product_kode, kode_sumber, kroscek_no)
SELECT s.periode, s.row_no::int, {nz('nama_final')}, {nz('varian')}, {nz('kemasan')},
  {nz('satuan')}, {nz('hpp')}::numeric, {nz('kategori_id')}, {nz('line_id')},
  {nz('class_id')}, {nz('sub_class_id')}, {nz('product_kode')}, {nz('kode_sumber')},
  {nz('kroscek_no')}::int
FROM stg_setup s
ON CONFLICT (periode, row_no) DO UPDATE SET
  nama_final = EXCLUDED.nama_final, varian = EXCLUDED.varian, kemasan = EXCLUDED.kemasan,
  satuan = EXCLUDED.satuan, hpp = EXCLUDED.hpp, kategori_id = EXCLUDED.kategori_id,
  line_id = EXCLUDED.line_id, class_id = EXCLUDED.class_id,
  sub_class_id = EXCLUDED.sub_class_id, product_kode = EXCLUDED.product_kode,
  kode_sumber = EXCLUDED.kode_sumber, kroscek_no = EXCLUDED.kroscek_no,
  imported_at = now();

-- Antrean review disegarkan: baris yang sekarang sudah bisa di-resolve (master
-- sudah dilengkapi HoD Business) hilang sendiri dari daftar.
DELETE FROM product_code_review r
 WHERE r.sumber = '{SUMBER}'
   AND NOT EXISTS (SELECT 1 FROM stg_review s
                    WHERE s.sumber = r.sumber AND s.sumber_baris::int = r.sumber_baris);
INSERT INTO product_code_review (sumber, sumber_baris, nama, brand, kemasan, satuan,
  kode_legacy, kategori_nama, line_nama, class_nama, sub_class_nama, masalah)
SELECT s.sumber, s.sumber_baris::int, s.nama, {nz('brand')}, {nz('kemasan')}, {nz('satuan')},
  {nz('kode_legacy')}, {nz('kategori_nama')}, {nz('line_nama')}, {nz('class_nama')},
  {nz('sub_class_nama')}, s.masalah
FROM stg_review s
ON CONFLICT (sumber, sumber_baris) DO UPDATE SET
  nama = EXCLUDED.nama, brand = EXCLUDED.brand, kategori_nama = EXCLUDED.kategori_nama,
  line_nama = EXCLUDED.line_nama, class_nama = EXCLUDED.class_nama,
  sub_class_nama = EXCLUDED.sub_class_nama, masalah = EXCLUDED.masalah, imported_at = now();

\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'baris_setup=' || count(*) FROM product_pricelist_setup WHERE periode = '{args.periode}';
SELECT 'ada_hpp=' || count(hpp) FROM product_pricelist_setup WHERE periode = '{args.periode}';
SELECT 'klasifikasi_lengkap=' || count(*) FROM product_pricelist_setup
 WHERE periode = '{args.periode}' AND sub_class_id IS NOT NULL;
SELECT 'kepasang_product_code=' || count(product_kode) FROM product_pricelist_setup
 WHERE periode = '{args.periode}';
SELECT 'review_terbuka_kroscek=' || count(*) FROM product_code_review
 WHERE sumber = '{SUMBER}' AND status = 'terbuka';
-- Margin turunan (bukan disimpan): sanity check rentang.
SELECT 'margin_min=' || round(min(1 - s.hpp / p.price_list), 4) ||
       ' margin_max=' || round(max(1 - s.hpp / p.price_list), 4)
  FROM product_pricelist_setup s JOIN product_pricelist p USING (periode, row_no)
 WHERE s.periode = '{args.periode}' AND s.hpp IS NOT NULL AND p.price_list > 0;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print("== DB (staging load + upsert + laporan; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body,
                     capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
for p in tmp.values():
    os.unlink(p)

# Diulang di baris terakhir: header bisa ke-scroll hilang, dan menulis ke
# database yang salah adalah kegagalan yang paling gampang tidak disadari.
print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database '{args.db}' ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
