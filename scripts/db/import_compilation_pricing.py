#!/usr/bin/env python3
"""Importer model harga Compilation → tabel `pricelist` (043) + segarkan HPP di
`product_pricelist_setup` (073).

Sumber: Google Sheet **"3. PL Product Compilation"**, sheet `Business IVD` /
`Business Medical` — kolom HPP · % (margin) · PL · Price List · Diskon End User ·
Nett Price End User + klasifikasi. Berbeda dari Sheet2 kroscek (yang isinya price
book Direktur): di sini seluruh model harga internal ada per baris, dan ada
**`Kode 2025`** = nomor item Accurate berjalan (IDS.0299 / AKS.0828) — satu-satunya
kolom yang bisa memasangkan baris ke `accurate_item`, syarat wajib tabel 043.

Data TIDAK di-commit — repo ini PUBLIC, HPP bukan data publik. Hanya stdlib
(tanpa openpyxl) supaya bisa jalan di mesin prod apa adanya.

CSV export Google Sheets ditangani apa adanya:
  • pemisah `;` maupun `,` (dideteksi dari baris header)
  • baris pertama bisa berisi URL/judul → header dicari di 6 baris pertama
  • angka format Indonesia: "28.875.000,00" → 28875000.00 · "28,7%" → 0.287
  • ratusan ribu baris kosong di ekor file (batas baris Sheets) → dilewati
  • nilai error spreadsheet (#REF!, #N/A, #VALUE!) diperlakukan sebagai kosong
  • nama kolom kembar ("%" muncul 2x) → dibaca lewat POSISI, bukan nama:
    margin = kolom persis setelah "HPP"

Yang TIDAK diimpor, sengaja: **alokasi insentif** (% Wrg End User / % HOD IVD /
% HOD Sales). Di sheet ini Value-nya = % × **Price List** (terverifikasi 398/398
baris untuk Value WRG), sedangkan apps/web/src/lib/pricelist.ts menghitung
% × **margin Rupiah**. Dua basis yang beda; sampai HoD Business memutuskan yang
mana, persentasenya dibiarkan 0 supaya kolom insentif & poin di UI jelas "belum
diisi" alih-alih menampilkan angka yang salah 3,5x.

Price List dari sumber DISIMPAN apa adanya (kolom `pricelist.price_list`,
migrasi 076) karena sudah dibulatkan manual — hpp/(1-margin) tidak
mengembalikannya (37 dari 398 baris pada export 30 Juli 2026).

Baris `pricelist` berstatus **published** TIDAK disentuh (itu harga yang sedang
dilihat AM) kecuali --termasuk-published.

⚠️ Penyegaran HPP price book (073) saat ini praktis TIDAK kena apa-apa, dan itu
bukan bug: diukur di dev 30 Juli 2026, **385 dari 386** `Kode 2025` di sheet ini
memang ada di `product_code`, tapi **0** di antaranya sampai ke baris
`product_pricelist_setup`. Sebabnya dua populasi kode nyaris tak beririsan —
baris price book dipasangkan ke `product_code` lewat kode 5-bagian
(`kode`/`kode_legacy`), dan justru baris-baris itulah yang `kode_2025`-nya kosong
(dari 201 baris setup yang punya pasangan, cuma 58 product_code-nya ber-kode_2025).
Jadi HPP price book tetap datang dari Sheet2 kroscek (`import_kroscek_pricelist.py`,
942 baris). Jalur ini ditinggalkan menyala karena akan mulai berguna begitu master
produk dibersihkan dan satu baris `product_code` memuat kedua kode; kalau tidak mau
menunggu, pakai --tanpa-setup.

Pakai:
  python3 import_compilation_pricing.py --file <csv> --db <wrg_os_dev|wrg_os_prod> \\
      [--sheet "Business IVD"] [--tanpa-setup] [--termasuk-published] [--apply]
  default = DRY-RUN (BEGIN … ROLLBACK; FK & CHECK tetap diuji sungguhan).

Klasifikasi produk TIDAK diurus di sini — pakai import_product_classification.py
dengan sheet yang sama (kolom Kategori/Product Line/Class/Sub Class-nya identik).
"""
import argparse, csv, os, re, subprocess, sys, tempfile
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

ERR = ("#REF!", "#N/A", "#VALUE!", "#NAME?", "#DIV/0!", "#NUM!", "#NULL!")

clean = lambda v: " ".join(str(v or "").split())


def kosong(v: str) -> bool:
    v = clean(v)
    return v == "" or v == "-" or v.upper().startswith("#")


def angka(v: str):
    """'28.875.000,00' / '28,7%' / '40500000' / '0.05' → Decimal. None kalau kosong.

    Dua pemisah sekaligus → yang paling KANAN desimal (export id-ID: titik
    ribuan, koma desimal). Satu jenis saja → RIBUAN kalau tiap kelompok setelah
    yang pertama tepat 3 digit ('1.076' = seribu tujuh puluh enam), selain itu
    desimal ('0.05', '28,7').

    Ambiguitas yang diakui: '1.000' dibaca 1000, bukan 1,0 — sumbernya export
    id-ID dan harga satu koma nol rupiah tidak ada di sheet ini.
    """
    s = clean(v)
    if kosong(s):
        return None
    persen = s.endswith("%")
    s = s.rstrip("%").replace("Rp", "").replace(" ", "").replace(" ", "")
    neg = s.startswith("(") and s.endswith(")") or s.startswith("-")
    s = s.strip("()-")
    if not s:
        return None
    if "," in s and "." in s:
        des = "," if s.rfind(",") > s.rfind(".") else "."
        s = s.replace("." if des == "," else ",", "").replace(des, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        bagian = s.split(sep)
        if bagian[0] != "" and all(len(b) == 3 for b in bagian[1:]):
            s = "".join(bagian)                        # pemisah ribuan: 1.076 → 1076
        else:
            s = bagian[0] + "." + "".join(bagian[1:])  # pemisah desimal: 0.05 · 28,7
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    if neg:
        d = -d
    return d / 100 if persen else d


ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV export sheet Business IVD / Business Medical")
# Wajib disebut, tanpa default: menulis ke database yang salah adalah kegagalan
# yang paling gampang tidak disadari (sudah kejadian di importer price book).
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
ap.add_argument("--sheet", default="Business IVD", help="label sumber (untuk laporan saja)")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--tanpa-setup", action="store_true",
                help="jangan segarkan HPP di product_pricelist_setup (073), cuma tabel pricelist")
ap.add_argument("--termasuk-published", action="store_true",
                help="ikut menimpa baris pricelist yang sudah published (default: dilewati)")
ap.add_argument("--izinkan-selisih", action="store_true",
                help="lanjut walau ada baris yang Nett ≠ Price List × (1-diskon)")
args = ap.parse_args()


def psql_baca(sql):
    res = subprocess.run(["psql", args.db, "-tAF", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        sys.exit(f"gagal membaca database '{args.db}'")
    return [l.split("\t") for l in res.stdout.splitlines() if l.strip()]


# ── 1. prasyarat DB ────────────────────────────────────────────────────────
if psql_baca("SELECT to_regclass('public.pricelist') IS NOT NULL")[0][0] != "t":
    sys.exit(f"tabel pricelist belum ada di '{args.db}' — migrasi 043 belum ke-apply")
kolom = {r[0] for r in psql_baca(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name='pricelist'")}
if "price_list" not in kolom:
    sys.exit(f"kolom pricelist.price_list belum ada di '{args.db}' — jalankan migrasi 076 dulu "
             f"(infra/postgres/init/076_pricelist_price_list.sql)")

# accurate_item: satu-satunya kunci sah ke tabel pricelist.
ITEM = {}
for r in psql_baca("SELECT upper(no), id FROM accurate_item WHERE no IS NOT NULL AND no <> ''"):
    ITEM.setdefault(r[0], r[1])
if not ITEM:
    sys.exit(f"accurate_item kosong di '{args.db}' — mirror Accurate belum ada, tak ada yang bisa dipasangkan")

PUBLISHED = {r[0] for r in psql_baca("SELECT product_id::text FROM pricelist WHERE status = 'published'")}
SUDAH = {r[0] for r in psql_baca("SELECT product_id::text FROM pricelist")}

# ── 2. baca CSV ────────────────────────────────────────────────────────────
WAJIB = ["Kode 2025", "Nama Accurate 2026", "HPP", "Price List", "Diskon End User"]

with open(args.file, encoding="utf-8-sig", newline="") as f:
    contoh = f.read(64 * 1024)
    f.seek(0)
    delim = ";" if contoh.count(";") > contoh.count(",") else ","
    rd = csv.reader(f, delimiter=delim)
    hdr = hi = None
    for i, row in enumerate(rd, start=1):
        nm = [clean(c) for c in row]
        if "Nama Accurate 2026" in nm:
            hdr, hi = nm, i
            break
        if i > 6:
            break
    if hdr is None:
        sys.exit(f"header tak ketemu di 6 baris pertama (pemisah terdeteksi '{delim}') — "
                 f"pastikan ini export sheet Business IVD/Medical")
    kurang = [k for k in WAJIB if k not in hdr]
    if kurang:
        sys.exit(f"kolom hilang: {kurang}\nheader terbaca: {hdr}")

    IX = {}
    for j, n in enumerate(hdr):
        if n and n not in IX:
            IX[n] = j
    # Nama kolom "%" muncul dua kali (setelah HPP, dan setelah PL). Margin = yang
    # PERSIS setelah HPP; jangan diambil lewat nama.
    I_MARGIN = IX["HPP"] + 1
    if clean(hdr[I_MARGIN]) not in ("%", "% Margin", "Margin"):
        sys.exit(f"kolom setelah HPP bukan persen margin, tapi {hdr[I_MARGIN]!r} — struktur sheet berubah, "
                 f"periksa dulu sebelum impor")

    rows, lap = [], Counter()
    salah_nett, tanpa_kode, tak_cocok, dobel = [], 0, [], []
    seen_kode = {}
    for n, row in enumerate(rd, start=hi + 1):
        g = lambda k: clean(row[IX[k]]) if k in IX and IX[k] < len(row) else ""
        nama = g("Nama Accurate 2026")
        if kosong(nama):
            continue
        lap["baris"] += 1

        hpp = angka(g("HPP"))
        margin = angka(clean(row[I_MARGIN]) if I_MARGIN < len(row) else "")
        pl = angka(g("Price List"))
        disc = angka(g("Diskon End User"))
        nett = angka(g("Nett Price End User")) if "Nett Price End User" in IX else None

        kode = g("Kode 2025").upper()
        if kosong(kode):
            tanpa_kode += 1
            continue
        if kode in seen_kode:
            dobel.append((kode, seen_kode[kode], n, nama[:40]))
            continue
        seen_kode[kode] = n

        # Pasangan ke accurate_item WAJIB untuk tabel `pricelist` (043) — FK-nya
        # ke sana. Tapi penyegaran HPP price book (073) jalan lewat product_code,
        # tanpa perlu mirror Accurate, jadi baris yang tak punya pasangan TETAP
        # dibawa ke staging dan cuma dikecualikan dari insert `pricelist`.
        pid = ITEM.get(kode)
        if pid is None:
            tak_cocok.append((n, kode, nama[:45]))

        if hpp is None or hpp <= 0:
            lap["skip_hpp_kosong"] += 1
            continue
        if pl is None or pl <= 0:
            lap["skip_pl_kosong"] += 1
            continue
        if margin is None or not (0 <= margin < 1):
            lap["skip_margin_aneh"] += 1
            continue
        if disc is None or not (0 <= disc < 1):
            disc = Decimal(0)
            lap["diskon_dianggap_0"] += 1

        # Nett cuma DIPERIKSA (tidak disimpan — turunan di aplikasi).
        if nett is not None and abs(pl * (1 - disc) - nett) > max(Decimal(2), pl * Decimal("0.001")):
            salah_nett.append((n, nama[:40], str(pl), str(disc), str(nett)))

        boleh = pid is not None
        if boleh and pid in PUBLISHED and not args.termasuk_published:
            boleh = False
            lap["dilewati_published"] += 1

        lap["siap_setup"] += 1          # semua baris berangka sah → bahan refresh 073
        if boleh:
            lap["siap_pricelist"] += 1
            lap["perbarui" if pid in SUDAH else "baru"] += 1
        rows.append([pid or "", "t" if boleh else "f",
                     f"{hpp:.2f}", f"{margin:.4f}", f"{disc:.4f}", f"{pl:.2f}", kode, nama])

# ── 3. laporan + gerbang ───────────────────────────────────────────────────
print(f"== Importer model harga Compilation ({'APPLY' if args.apply else 'DRY-RUN'}) → "
      f"db={args.db} sheet='{args.sheet}' ==")
print(f"  baris sumber ber-nama : {lap['baris']}")
print(f"  → siap masuk pricelist: {lap['siap_pricelist']}  (baru {lap['baru']} · perbarui {lap['perbarui']})")
print(f"  → bahan refresh HPP 073: {lap['siap_setup']}  (tak perlu pasangan Accurate — lewat product_code)")
print(f"  tanpa 'Kode 2025'     : {tanpa_kode}  (tak bisa dipasangkan ke accurate_item — tabel 043 mewajibkan)")
print(f"  kode tak ada di mirror: {len(tak_cocok)}  (dikecualikan dari pricelist, tetap dipakai utk 073)")
if tak_cocok:
    for n, k, nama in tak_cocok[:5]:
        print(f"       baris {n}: {k} — {nama}")
    if len(tak_cocok) > 5:
        print(f"       … {len(tak_cocok) - 5} lagi")
if lap["dilewati_published"]:
    print(f"  DILEWATI (published)  : {lap['dilewati_published']}  (harga yang sedang dilihat AM; "
          f"pakai --termasuk-published kalau memang mau ditimpa)")
for k, label in (("skip_hpp_kosong", "HPP kosong/<=0"), ("skip_pl_kosong", "Price List kosong"),
                 ("skip_margin_aneh", "margin di luar [0,1)"), ("diskon_dianggap_0", "diskon kosong → 0")):
    if lap[k]:
        print(f"  {label:22s}: {lap[k]}")
print(f"  insentif (% WRG/Promosi/HOD): TIDAK diimpor — basisnya beda dari rumus aplikasi, "
      f"pct_* dibiarkan 0 (lihat docstring)")

if dobel:
    print(f"  ⚠️  'Kode 2025' dobel di sheet: {len(dobel)}")
    for k, a, b, nama in dobel[:5]:
        print(f"       {k}: baris {a} & {b} ({nama}) — yang kedua diabaikan")

if salah_nett:
    print(f"  ⚠️  Nett ≠ Price List × (1-diskon): {len(salah_nett)} baris")
    for n, nama, a, b, c in salah_nett[:5]:
        print(f"       baris {n} {nama}: PL {a} diskon {b} → nett di sheet {c}")
    if not args.izinkan_selisih:
        sys.exit("harga di sheet tidak konsisten — perbaiki sheet, atau pakai --izinkan-selisih "
                 "(Nett tidak disimpan, tapi selisih begini biasanya tanda kolom tergeser).")

if not rows:
    sys.exit("tidak ada baris yang bisa masuk — cek laporan di atas (paling sering: "
             "'Kode 2025' kosong, atau mirror accurate_item tak punya kodenya).")

# ── 4. muat ke DB ──────────────────────────────────────────────────────────
fd, tmp = tempfile.mkstemp(suffix=".csv", prefix="compil_pricing_")
with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["product_id", "boleh_pricelist", "hpp", "margin_pct", "diskon_pct", "price_list",
                "kode_2025", "nama"])
    w.writerows(rows)

setup_sql = "" if args.tanpa_setup else """
-- Segarkan HPP price book (073) untuk baris yang bisa dipasangkan lewat kode
-- produk: kode_2025 → product_code → (kode | kode_legacy) → baris setup.
-- HANYA pasangan 1:1. Satu kode_2025 yang menunjuk beberapa baris price book
-- (varian bernama sama) TIDAK disentuh — HPP-nya bisa beda per varian dan
-- importer ini tak punya cara membedakannya.
CREATE TEMP TABLE stg_map AS
SELECT s.kode_2025, p.periode, p.row_no
  FROM stg_pricing s
  JOIN product_code c ON upper(c.kode_2025) = s.kode_2025
  JOIN product_pricelist_setup p
    ON p.product_kode = c.kode OR p.kode_sumber = c.kode_legacy
 GROUP BY 1,2,3;

DELETE FROM stg_map m
 WHERE (SELECT count(*) FROM stg_map x WHERE x.kode_2025 = m.kode_2025) > 1
    OR (SELECT count(*) FROM stg_map x WHERE x.periode = m.periode AND x.row_no = m.row_no) > 1;

UPDATE product_pricelist_setup t
   SET hpp = s.hpp::numeric, imported_at = now()
  FROM stg_map m
  JOIN stg_pricing s ON s.kode_2025 = m.kode_2025
 WHERE t.periode = m.periode AND t.row_no = m.row_no
   AND t.hpp IS DISTINCT FROM s.hpp::numeric;
"""

sql = f"""
CREATE TEMP TABLE stg_pricing (product_id TEXT, boleh_pricelist TEXT, hpp TEXT, margin_pct TEXT,
  diskon_pct TEXT, price_list TEXT, kode_2025 TEXT, nama TEXT);
\\copy stg_pricing FROM '{tmp}' WITH (FORMAT csv, HEADER true)

-- Insentif & loyalty TIDAK diisi importer (lihat docstring): kolomnya dibiarkan
-- pada nilai lamanya untuk baris yang sudah ada, dan DEFAULT 0 untuk baris baru.
INSERT INTO pricelist (product_id, hpp, margin_pct, diskon_pct, price_list, created_by)
SELECT s.product_id::bigint, s.hpp::numeric, s.margin_pct::numeric, s.diskon_pct::numeric,
       s.price_list::numeric, 'import_compilation_pricing.py'
  FROM stg_pricing s
 WHERE s.boleh_pricelist = 't'
ON CONFLICT (product_id) DO UPDATE SET
  hpp = EXCLUDED.hpp, margin_pct = EXCLUDED.margin_pct, diskon_pct = EXCLUDED.diskon_pct,
  price_list = EXCLUDED.price_list, updated_at = now();
{setup_sql}
\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'pricelist_total=' || count(*) FROM pricelist;
SELECT 'pricelist_draft=' || count(*) FROM pricelist WHERE status = 'draft';
SELECT 'pricelist_published=' || count(*) FROM pricelist WHERE status = 'published';
SELECT 'ada_price_list_sumber=' || count(price_list) FROM pricelist;
SELECT 'beda_dari_hitungan_margin=' || count(*) FROM pricelist
 WHERE price_list IS NOT NULL AND margin_pct < 1
   AND round(price_list) <> round(hpp / (1 - margin_pct));
"""
if not args.tanpa_setup:
    sql += """SELECT 'setup_hpp_terisi=' || count(hpp) FROM product_pricelist_setup;
SELECT 'setup_dipasangkan_dari_sheet=' || count(*) FROM stg_map;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print("== DB (staging load + upsert + laporan; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run(["psql", args.db, "-v", "ON_ERROR_STOP=1"], input=body,
                     capture_output=True, text=True)
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)
os.unlink(tmp)

# Diulang di baris terakhir: header bisa ke-scroll hilang, dan menulis ke
# database yang salah adalah kegagalan yang paling gampang tidak disadari.
print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database '{args.db}' ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
print("   Klasifikasi produk: jalankan import_product_classification.py dengan sheet yang sama.")
