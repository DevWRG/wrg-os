#!/usr/bin/env python3
"""Importer Compilation FINAL → basis harga (071) + Setup Harga (073).

Sumber: `Compile - 3__PL_Product_Compilation_FINAL_*.xlsx` sheet **Business** —
satu baris = satu SKU lengkap: klasifikasi (nama), HPP, margin, Price List,
Diskon End User, Nett Price End User, alokasi insentif, poin, konfirmasi area.
Export sheet-nya ke CSV lalu tunjuk file-nya (stdlib saja, tanpa openpyxl, supaya
bisa jalan di mesin prod apa adanya).

Urutan yang benar — kode produk dulu, harga belakangan:
  1. python3 import_product_classification.py --db-product <DB_Product.csv> \\
         --produk "Compilation FINAL=<Business.csv>" --daftarkan-master --db <db> --apply
  2. python3 import_compilation_final.py --file <Business.csv> --db <db> --apply

Kenapa dua langkah, bukan satu: kode produk itu keputusan permanen (menempel di
Accurate), sedangkan harga berubah tiap periode. Importer ini TIDAK pernah
menerbitkan kode — dia hanya memakai `product_code` yang sudah ada dan MELEWATI
baris yang belum punya kode, lalu melaporkannya.

Dua tabel yang diisi, sengaja terpisah (lihat komentar migrasi 071/073):
  • `product_pricelist` (071)       basis harga: Price List · Diskon Maks ·
    Nett terendah · Nett+PPN. Ini yang dibaca menu Price Book (AM) lewat lapisan
    publish, dan yang dihitung menu Ringkasan. TANPA HPP.
  • `product_pricelist_setup` (073) lapisan kerja: HPP, klasifikasi, pautan ke
    `product_code`, plus gerbang publish (status draft/published).

HPP hanya ada di 073 — kalau ikut ditaruh di 071, satu `SELECT *` yang lupa
memilih kolom membocorkan margin ke endpoint yang dibaca sales (HANDOVER §1/§9).

Idempoten lewat kunci (periode, row_no) = urutan baris di sheet. Re-import file
yang sama = UPDATE, dan baris yang hilang dari sheet DIHAPUS dari periode itu.
Status publish TIDAK ikut ter-reset saat re-import (lihat ON CONFLICT di bawah):
harga boleh diperbarui tanpa diam-diam menarik yang sudah terbit ke AM.

Pakai:
  python3 import_compilation_final.py --file <Business.csv> --db <wrg_os_dev|wrg_os_prod> \\
      [--periode COMPILATION-2026] [--publish] [--apply]
  default = DRY-RUN (BEGIN … ROLLBACK; FK & CHECK tetap diuji sungguhan).
"""
import argparse, csv, os, subprocess, sys, tempfile
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV export sheet Business")
# Wajib disebut, tanpa default — 'berhasil' ke database yang salah adalah
# kegagalan yang paling gampang tidak disadari (sudah pernah kejadian).
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
# Default HARUS sama dengan PERIODE_DEFAULT di apps/api/src/repo/pricebook.ts
# ('H2-2026'): menu Setup Harga & tab Harga per Produk memanggil endpoint tanpa
# parameter periode, jadi periode lain tidak akan pernah muncul di UI. File
# Compilation FINAL 6 Agt 2026 memang price list H2 2026, jadi labelnya cocok.
ap.add_argument("--periode", default="H2-2026")
ap.add_argument("--publish", action="store_true",
                help="langsung set status='published' (tampil ke AM). Default draft.")
ap.add_argument("--published-by", default="importer compilation final")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
args = ap.parse_args()

clean = lambda v: " ".join(str(v or "").split())
low = lambda v: clean(v).lower()

# Kategori master → kolom `lini` di 071, yang CHECK-nya hanya mengenal IVD/Medical.
LINI = {"ivd": "IVD", "non ivd": "Medical", "obat": "Medical", "utility": "Medical"}


def angka(v):
    """Nilai numerik sheet → Decimal. Kosong / error spreadsheet (#N/A, #REF!) → None."""
    s = clean(v).replace("%", "")
    if not s or s.startswith("#"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def rnd(v):
    return v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def psql_baca(sql):
    res = subprocess.run(["psql", args.db, "-tAF", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        sys.exit(f"gagal membaca database '{args.db}'")
    return [l.split("\t") for l in res.stdout.splitlines() if l.strip()]


# ── kode produk yang sudah terbit ──────────────────────────────────────────
if psql_baca("SELECT to_regclass('public.product_code') IS NOT NULL")[0][0] != "t":
    sys.exit(f"tabel product_code belum ada di '{args.db}' — jalankan migrasi 072 dulu")
KODE = {}
for r in psql_baca("SELECT identitas, kode, kategori_id, line_id, class_id, sub_class_id "
                   "FROM product_code"):
    KODE[r[0]] = tuple(r[1:])
if not KODE:
    sys.exit(f"`product_code` di '{args.db}' masih kosong — jalankan "
             f"import_product_classification.py dulu (kode produk harus ada sebelum harga)")

# ── baca sheet ─────────────────────────────────────────────────────────────
with open(args.file, encoding="utf-8-sig", newline="") as f:
    rows = [r for r in csv.reader(f)]

hdr_i = None
for i, r in enumerate(rows[:6]):
    nama = [clean(c) for c in r]
    if "Kategori" in nama and "Sub Class" in nama and "Nama Accurate 2026" in nama:
        hdr_i = i
        break
if hdr_i is None:
    sys.exit("header tidak ketemu (butuh kolom Kategori, Sub Class, Nama Accurate 2026)")

# Nama kolom KEMBAR di sheet ini ("%" dua kali, blok bantu mengulang
# "Kategori/Product Line/Class/Sub Class" di kolom 41-45 berisi id hasil VLOOKUP).
# Karena itu indeks diambil dari kemunculan PERTAMA, dan margin dibaca lewat
# POSISI (kolom persis setelah HPP) — sama seperti import_compilation_pricing.py.
ix = {}
for j, n in enumerate(clean(c) for c in rows[hdr_i]):
    if n and n not in ix:
        ix[n] = j
for wajib in ("HPP", "Price List", "Nama Accurate 2026"):
    if wajib not in ix:
        sys.exit(f"kolom '{wajib}' tidak ada di sheet")
c_margin = ix["HPP"] + 1
c_diskon = ix.get("Diskon End User", ix["Price List"] + 1)
c_nett = ix.get("Nett Price End User", c_diskon + 2)

out, lap, contoh_lewat = [], Counter(), []
margin_beda = 0
for n, r in enumerate(rows[hdr_i + 1:], start=1):
    g = lambda name: clean(r[ix[name]]) if name in ix and ix[name] < len(r) else ""
    gj = lambda j: clean(r[j]) if j < len(r) else ""
    nama = g("Nama Accurate 2026")
    if not nama:
        continue
    lap["baris"] += 1

    kode_2025 = g("Kode 2025")
    ident = f"K:{kode_2025.upper()}" if kode_2025 else f"N:{nama.upper()}"
    ref = KODE.get(ident)
    if not ref:
        # Belum punya kode produk → jangan diberi harga. Menyimpan harga untuk
        # produk tanpa kode bikin baris yatim yang tak bisa dipasangkan ke apa pun.
        lap["tanpa_kode"] += 1
        if len(contoh_lewat) < 6:
            contoh_lewat.append(f"{nama[:52]} (baris {n + hdr_i + 1})")
        continue
    kode, kid, pid, cid, sid = ref

    kat = g("Kategori")
    lini = LINI.get(low(kat))
    if not lini:
        lap["kategori_tak_dikenal"] += 1
        continue

    hpp, margin = angka(gj(ix["HPP"])), angka(gj(c_margin))
    pl, diskon, nett = angka(g("Price List")), angka(gj(c_diskon)), angka(gj(c_nett))
    if pl is None or nett is None:
        lap["harga_kosong"] += 1
        continue
    if diskon is None:
        diskon = Decimal("0")
    # Nett+PPN tidak ada di sheet ini (beda dengan file handover Direktur yang
    # membawanya apa adanya) → dihitung dari NETT, bukan dari Price List:
    # UU PPN Ps 1 ang 18, tarif efektif 11% per PMK 131/2024.
    ppn = rnd(nett * Decimal("1.11"))
    # Price List di sheet sering dibulatkan ke angka "cantik", jadi tidak selalu
    # persis hpp/(1-margin). Itu bukan error — dilaporkan saja, angka sheet menang.
    if hpp is not None and margin is not None and margin < 1:
        if abs(rnd(hpp / (1 - margin)) - pl) > 1:
            margin_beda += 1

    out.append([
        str(n), kode_2025, lini, g("Brand"), nama, g("Sub Class"), g("Kemasan"), kat,
        str(pl), str(diskon), str(nett), str(ppn),
        nama, g("Sub Class"), g("Kemasan"), g("Satuan"), "" if hpp is None else str(hpp),
        kid, pid, cid, sid, kode,
    ])
    lap["siap"] += 1

print(f"== Importer Compilation FINAL ({'APPLY' if args.apply else 'DRY-RUN'}) → "
      f"db={args.db} periode={args.periode} ==")
print(f"  baris sheet          : {lap['baris']}")
print(f"  siap diimpor         : {lap['siap']}")
print(f"  dilewati, belum punya kode produk : {lap['tanpa_kode']}")
for c in contoh_lewat:
    print(f"       {c}")
if lap["kategori_tak_dikenal"]:
    print(f"  kategori tak dikenal : {lap['kategori_tak_dikenal']}")
if lap["harga_kosong"]:
    print(f"  harga kosong         : {lap['harga_kosong']}")
print(f"  Price List != hpp/(1-margin) : {margin_beda} baris (angka sheet dipakai apa adanya)")
print(f"  status                : {'published' if args.publish else 'draft'}")
if not out:
    sys.exit("tidak ada baris yang bisa diimpor")

COLS = ["row_no", "kode", "lini", "brand", "nama", "varian", "kemasan", "kategori",
        "price_list", "diskon_maks", "harga_nett", "nett_ppn",
        "nama_final", "varian_setup", "kemasan_setup", "satuan", "hpp",
        "kategori_id", "line_id", "class_id", "sub_class_id", "product_kode"]
fd, path = tempfile.mkstemp(suffix=".csv", prefix="compilation_final_")
with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(COLS)
    w.writerows(out)

nz = lambda c: f"NULLIF(s.{c},'')"
status = "published" if args.publish else "draft"
sql = f"""
CREATE TEMP TABLE stg ({', '.join(c + ' TEXT' for c in COLS)});
\\copy stg FROM '{path}' WITH (FORMAT csv, HEADER true)

-- 1) basis harga (071). kategori_verified = true: klasifikasinya sudah lolos
-- resolusi hirarkis ke master saat kode produknya terbit.
INSERT INTO product_pricelist (periode, row_no, kode, lini, brand, nama, varian, kemasan,
  kategori, kategori_verified, price_list, diskon_maks, harga_nett, nett_ppn)
SELECT '{args.periode}', s.row_no::int, {nz('kode')}, s.lini, s.brand, s.nama, {nz('varian')},
  {nz('kemasan')}, {nz('kategori')}, true, s.price_list::numeric, s.diskon_maks::numeric,
  s.harga_nett::numeric, s.nett_ppn::numeric
FROM stg s
ON CONFLICT (periode, row_no) DO UPDATE SET
  kode = EXCLUDED.kode, lini = EXCLUDED.lini, brand = EXCLUDED.brand, nama = EXCLUDED.nama,
  varian = EXCLUDED.varian, kemasan = EXCLUDED.kemasan, kategori = EXCLUDED.kategori,
  price_list = EXCLUDED.price_list, diskon_maks = EXCLUDED.diskon_maks,
  harga_nett = EXCLUDED.harga_nett, nett_ppn = EXCLUDED.nett_ppn, imported_at = now();

-- 2) lapisan Setup Harga (073). Status publish SENGAJA tidak ditimpa saat
-- re-import: memperbarui harga tidak boleh diam-diam menarik SKU yang sudah
-- terbit ke AM. Override harga HoD juga dibiarkan apa adanya.
INSERT INTO product_pricelist_setup (periode, row_no, nama_final, varian, kemasan, satuan,
  hpp, kategori_id, line_id, class_id, sub_class_id, product_kode, kode_sumber, status,
  published_at, published_by)
SELECT '{args.periode}', s.row_no::int, s.nama_final, {nz('varian_setup')}, {nz('kemasan_setup')},
  {nz('satuan')}, NULLIF(s.hpp,'')::numeric, s.kategori_id, s.line_id, s.class_id,
  s.sub_class_id, s.product_kode, {nz('kode')}, '{status}',
  {"now()" if args.publish else "NULL"}, {f"'{args.published_by}'" if args.publish else "NULL"}
FROM stg s
ON CONFLICT (periode, row_no) DO UPDATE SET
  nama_final = EXCLUDED.nama_final, varian = EXCLUDED.varian, kemasan = EXCLUDED.kemasan,
  satuan = EXCLUDED.satuan, hpp = EXCLUDED.hpp, kategori_id = EXCLUDED.kategori_id,
  line_id = EXCLUDED.line_id, class_id = EXCLUDED.class_id,
  sub_class_id = EXCLUDED.sub_class_id, product_kode = EXCLUDED.product_kode,
  kode_sumber = EXCLUDED.kode_sumber, imported_at = now();

-- Baris periode ini yang tidak ada lagi di sheet (SKU ditarik). 073 ikut lewat
-- ON DELETE CASCADE.
DELETE FROM product_pricelist p
 WHERE p.periode = '{args.periode}'
   AND NOT EXISTS (SELECT 1 FROM stg s WHERE s.row_no::int = p.row_no);

\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'basis_harga_071=' || count(*) FROM product_pricelist WHERE periode='{args.periode}';
SELECT 'setup_073=' || count(*) FROM product_pricelist_setup WHERE periode='{args.periode}';
SELECT 'published=' || count(*) FROM product_pricelist_setup
  WHERE periode='{args.periode}' AND status='published';
SELECT 'terpaut_kode_produk=' || count(product_kode) FROM product_pricelist_setup
  WHERE periode='{args.periode}';
SELECT 'lini: ' || lini || ' = ' || count(*) FROM product_pricelist
  WHERE periode='{args.periode}' GROUP BY lini ORDER BY 1;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print(f"  staging csv           : {path} ({len(out)} baris)")
print("== DB (staging load + upsert + laporan; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body,
                     capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
os.unlink(path)

print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database "
      f"'{args.db}', periode {args.periode} ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
