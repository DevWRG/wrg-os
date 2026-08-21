#!/usr/bin/env python3
"""F142 Price Book importer — CSV handover Direktur → tabel `product_pricelist`.

Sumber: folder Drive `16-Sales-PriceList-H2-2026/WRG_Sales_PriceList_H2_2026.csv`
(1.031 SKU · 89 brand · 694 IVD + 337 Medical). CSV-nya UTF-8 BOM.

Data sengaja TIDAK di-commit — repo ini PUBLIC. Jalankan importer manual dengan
menunjuk file di Drive.

Idempoten: kunci (periode, row_no) → re-import file yang sama = UPDATE, bukan
duplikat. row_no = urutan baris di CSV (nama produk tidak unik, 141 SKU tanpa
kode Accurate — tak ada kunci bisnis yang bisa dipakai).

Verifikasi rumus sebelum masuk DB (HANDOVER §9 — kolom harga tidak boleh
dihitung ulang dengan pembulatan sendiri):
  harga_nett_terendah == ROUND(price_list * (1 - diskon_maks))
  nett_plus_ppn11     == ROUND(harga_nett_terendah * 1.11)

Toleransi Rp 1 untuk kasus SERI (hasil perkalian tepat berakhir ,5): generator
file sumber memakai pembulatan half-even (2,5 → 2) sedangkan ROUND() spreadsheet
half-up (2,5 → 3). Di H2-2026 ini kena 13 baris, semuanya beda Rp 1 di kolom PPN.
Angka tetap disimpan APA ADANYA dari sumber — importer cuma melaporkan, tidak
menghitung ulang. Selisih di luar kasus seri = ditolak (kecuali --izinkan-selisih).

Pakai:
  python3 import_pricebook.py --file <csv> --db <wrg_os_dev|wrg_os_prod> [--periode H2-2026] [--apply]
  default = DRY-RUN (txn + ROLLBACK, cuma laporan; TIDAK menulis).
  --db wajib disebut — lihat catatan di argumen --db.
"""
import argparse, csv, os, subprocess, sys, tempfile
from collections import Counter
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

COLS = ["row_no", "kode", "lini", "brand", "nama", "varian", "kemasan", "kategori",
        "kategori_verified", "price_list", "diskon_maks", "harga_nett", "nett_ppn",
        "rentang_harga", "catatan"]

# Header CSV sumber → kolom tabel.
SRC = {"kode": "kode", "lini": "lini", "brand": "brand", "nama_barang": "nama",
       "varian_sub_class": "varian", "kemasan": "kemasan", "kategori": "kategori",
       "kategori_terverifikasi": "kategori_verified", "price_list": "price_list",
       "diskon_maks": "diskon_maks", "harga_nett_terendah": "harga_nett",
       "nett_plus_ppn11": "nett_ppn", "rentang_harga": "rentang_harga", "catatan": "catatan"}

LINI = {"IVD", "Medical"}


def rnd(v: Decimal) -> Decimal:
    """Pembulatan ke rupiah penuh, half-up (sama dengan ROUND() spreadsheet)."""
    return v.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def seri(v: Decimal) -> bool:
    """True kalau hasil perkalian tepat berakhir ,5 — di situ half-up vs half-even beda."""
    return v - v.to_integral_value(rounding=ROUND_DOWN) == Decimal("0.5")


ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV price book (dari folder Drive)")
# Wajib disebut, TIDAK ada default. Kalau default-nya dev, salah ketik = importer
# lapor "1031 baris masuk" padahal nulis ke database yang salah, dan halaman prod
# tetap kosong tanpa satu pun pesan error. Sudah kejadian sekali.
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
ap.add_argument("--periode", default="H2-2026")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--izinkan-selisih", action="store_true",
                help="tetap import walau ada baris yang rumus harganya tidak cocok")
args = ap.parse_args()

# ── baca + validasi ────────────────────────────────────────────────────────
rows_out, rep = [], Counter()
salah_rumus, beda_seri, kategori_kosong = [], 0, 0

with open(args.file, encoding="utf-8-sig", newline="") as f:
    rd = csv.DictReader(f)
    missing = [h for h in SRC if h not in (rd.fieldnames or [])]
    if missing:
        sys.exit(f"kolom CSV hilang: {missing}\nada: {rd.fieldnames}")
    for i, raw in enumerate(rd, start=1):
        r = {tgt: (raw.get(src) or "").strip() for src, tgt in SRC.items()}
        if not r["nama"]:
            rep["skip_tanpa_nama"] += 1
            continue
        if r["lini"] not in LINI:
            sys.exit(f"baris {i}: lini tidak dikenal {r['lini']!r} (harus IVD/Medical)")

        pl, disc = Decimal(r["price_list"]), Decimal(r["diskon_maks"])
        nett, ppn = Decimal(r["harga_nett"]), Decimal(r["nett_ppn"])
        exp_nett, exp_ppn = pl * (1 - disc), nett * Decimal("1.11")
        for nilai, harap in ((nett, exp_nett), (ppn, exp_ppn)):
            if rnd(harap) == nilai:
                continue
            if seri(harap) and abs(harap - nilai) == Decimal("0.5"):
                beda_seri += 1          # half-even di sumber vs half-up — beda Rp 1
                continue
            salah_rumus.append((i, r["brand"], r["nama"], str(pl), str(disc), str(nett), str(ppn)))
            break

        r["row_no"] = str(i)
        # "YA"/"BELUM" → boolean
        r["kategori_verified"] = "true" if r["kategori_verified"].upper() == "YA" else "false"
        if not r["kategori"]:
            kategori_kosong += 1
        rows_out.append([r[c] for c in COLS])

        rep[f"lini:{r['lini']}"] += 1
        rep["total"] += 1
        if not r["kode"]:
            rep["tanpa_kode_accurate"] += 1
        if r["kategori_verified"] == "false":
            rep["kategori_belum_verified"] += 1
        rep[f"diskon:{disc}"] += 1

# Nama duplikat dalam brand yang sama — SKU ini WAJIB tampil dengan label varian
# + peringatan "N harga" di UI (HANDOVER §6, risiko mis-quote terbesar).
key = COLS.index("brand"), COLS.index("nama")
dup = Counter((r[key[0]], r[key[1]]) for r in rows_out)
dup = {k: v for k, v in dup.items() if v > 1}

print(f"== Price Book importer ({'APPLY' if args.apply else 'DRY-RUN'}) → db={args.db} periode={args.periode} ==")
print(f"  baris dibaca      : {rep['total']}  (IVD {rep['lini:IVD']} · Medical {rep['lini:Medical']})")
print(f"  brand             : {len(set(r[COLS.index('brand')] for r in rows_out))}")
print(f"  tanpa kode Accurate: {rep['tanpa_kode_accurate']}  (HANDOVER §8 poin 2)")
print(f"  kategori BELUM    : {rep['kategori_belum_verified']}  · kategori kosong: {kategori_kosong}")
print(f"  tier diskon       : " + " · ".join(f"{k.split(':')[1]}={v}" for k, v in sorted(rep.items()) if k.startswith("diskon:")))
print(f"  nama duplikat     : {len(dup)} kelompok = {sum(dup.values())} baris (wajib label varian di UI)")

if salah_rumus:
    print(f"  ⚠️  rumus harga tidak cocok: {len(salah_rumus)} baris")
    for s in salah_rumus[:10]:
        print(f"       baris {s[0]}: {s[1]} · {s[2]} — PL {s[3]} disc {s[4]} → nett {s[5]} ppn {s[6]}")
    if not args.izinkan_selisih:
        sys.exit("DITOLAK: perbaiki sumber, atau jalankan ulang dengan --izinkan-selisih.")
else:
    print("  rumus harga       : cocok di semua baris")
if beda_seri:
    print(f"  beda pembulatan seri: {beda_seri} nilai (half-even di sumber vs half-up; selisih Rp 1, disimpan apa adanya)")

# ── muat ke DB ─────────────────────────────────────────────────────────────
fd, csv_path = tempfile.mkstemp(suffix=".csv", prefix="pricebook_")
with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(COLS)
    w.writerows(rows_out)

nz = lambda c: f"NULLIF(s.{c},'')"
sql = f"""
CREATE TEMP TABLE stg ({', '.join(c + ' TEXT' for c in COLS)});
\\copy stg FROM '{csv_path}' WITH (FORMAT csv, HEADER true)
INSERT INTO product_pricelist (
  periode, row_no, kode, lini, brand, nama, varian, kemasan, kategori,
  kategori_verified, price_list, diskon_maks, harga_nett, nett_ppn, rentang_harga, catatan)
SELECT '{args.periode}', s.row_no::int, {nz('kode')}, s.lini, s.brand, s.nama,
  {nz('varian')}, {nz('kemasan')}, {nz('kategori')}, s.kategori_verified::boolean,
  s.price_list::numeric, s.diskon_maks::numeric, s.harga_nett::numeric,
  s.nett_ppn::numeric, {nz('rentang_harga')}, {nz('catatan')}
FROM stg s
ON CONFLICT (periode, row_no) DO UPDATE SET
  kode=EXCLUDED.kode, lini=EXCLUDED.lini, brand=EXCLUDED.brand, nama=EXCLUDED.nama,
  varian=EXCLUDED.varian, kemasan=EXCLUDED.kemasan, kategori=EXCLUDED.kategori,
  kategori_verified=EXCLUDED.kategori_verified, price_list=EXCLUDED.price_list,
  diskon_maks=EXCLUDED.diskon_maks, harga_nett=EXCLUDED.harga_nett,
  nett_ppn=EXCLUDED.nett_ppn, rentang_harga=EXCLUDED.rentang_harga,
  catatan=EXCLUDED.catatan, imported_at=now();

-- Baris periode ini yang TIDAK ada lagi di CSV (SKU ditarik dari price book).
DELETE FROM product_pricelist p
 WHERE p.periode = '{args.periode}'
   AND NOT EXISTS (SELECT 1 FROM stg s WHERE s.row_no::int = p.row_no);

\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'baris_periode=' || count(*) FROM product_pricelist WHERE periode='{args.periode}';
SELECT 'cocok_accurate=' || count(*) FROM product_pricelist p
  JOIN accurate_item ai ON ai.no = p.kode WHERE p.periode='{args.periode}';
SELECT 'accurate_di_luar_keagenan=' || count(*) FROM accurate_item ai
  WHERE NOT EXISTS (SELECT 1 FROM product_pricelist p
                    WHERE p.periode='{args.periode}' AND p.kode = ai.no);
SELECT 'lini: ' || lini || ' = ' || count(*) FROM product_pricelist
  WHERE periode='{args.periode}' GROUP BY lini ORDER BY 1;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print(f"  staging csv       : {csv_path} ({len(rows_out)} baris)")
print("== DB (staging load + upsert + report; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body, capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
os.unlink(csv_path)

# Diulang di baris terakhir: header bisa ke-scroll hilang, dan "berhasil" ke
# database yang salah adalah kegagalan yang paling gampang tidak disadari.
print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database "
      f"'{args.db}', periode {args.periode} ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
