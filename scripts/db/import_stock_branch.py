#!/usr/bin/env python3
"""F37 Cross-Branch Stock importer — CSV opname tim gudang → `item_stock_branch`.

Kenapa importer, bukan form di web: stok per gudang itu data milik tim gudang
yang hidupnya di Excel (pola sama Price Book / Klasifikasi Produk / KSO master).
Mengetik ulang ribuan SKU × 5 gudang lewat form bukan alur yang realistis.

Bentuk CSV yang diharapkan — WIDE (satu baris per SKU, satu kolom per gudang):

    sku,PUSAT,KEMANGI,SBY,MADIUN,JEMBER
    IDS.0276,120,0,45,,12
    IDS.0301,,,8,3,

  - Kolom pertama WAJIB `sku` (dicocokkan ke `accurate_item.no`).
  - Nama kolom lain harus sama dengan `warehouse.kode` yang aktif. Kolom yang
    tak dikenal DITOLAK (bukan diabaikan diam-diam) — typo header berarti
    seluruh kolom stok hilang tanpa jejak.
  - Sel KOSONG = tidak ada data untuk gudang itu → baris TIDAK ditulis (beda
    dari 0, yang berarti "sudah dihitung, hasilnya nol"). Perbedaan ini penting:
    UI membedakan "belum diisi" dari "stok habis".
  - `--long` untuk format alternatif: sku,gudang,qty (satu baris per kombinasi).

Idempoten: kunci (item_id, warehouse_kode) → re-import file yang sama = UPDATE.

SKU yang tak ada di `accurate_item` DITOLAK dan dilaporkan (bukan dibuat
diam-diam): mirror Accurate adalah master item, dan stok untuk SKU hantu tak
bisa dikorelasikan ke apa pun.

Pakai:
  python3 import_stock_branch.py --file <csv> --db <wrg_os|wrg_os_prod> [--long] [--source import] [--apply]
  default = DRY-RUN (BEGIN + ROLLBACK; cuma laporan, TIDAK menulis).
  --db wajib disebut — "berhasil" ke database yang salah adalah kegagalan yang
  paling gampang tidak disadari.

Tanpa `psql` native (mis. dev Windows yang DB-nya di Docker), override
pemanggilnya lewat env PSQL_BIN — nama database tetap diteruskan sebagai
argumen posisional, jadi bentuk ini bekerja apa adanya:

  PSQL_BIN="docker compose exec -T postgres psql -U wrg" \\
    python3 import_stock_branch.py --file stok.csv --db wrg_os
"""
import argparse, csv, io, os, shlex, subprocess, sys
from decimal import Decimal, InvalidOperation

# Pemanggil psql. Default "psql"; bisa diganti env PSQL_BIN (lihat docstring).
PSQL = shlex.split(os.environ.get("PSQL_BIN", "psql"))

ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV opname stok per gudang")
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os / wrg_os_prod")
ap.add_argument("--long", action="store_true", help="format panjang: sku,gudang,qty")
ap.add_argument("--source", default="import", choices=["import", "manual"],
                help="asal angka yang dicatat di kolom source (default: import). "
                     "JANGAN pakai 'accurate' — itu khusus puller otomatis.")
ap.add_argument("--desimal", choices=["koma", "titik"],
                help="nyatakan konvensi desimal CSV bila ada nilai ambigu seperti "
                     "'1.500' ('.' diikuti tepat 3 digit). Tanpa ini nilai ambigu DITOLAK.")
ap.add_argument("--hapus-tak-disebut", action="store_true",
                help="hapus baris stok yang TIDAK ada di CSV — TERBATAS pada gudang "
                     "yang kolomnya hadir di CSV itu. Gudang lain tidak disentuh. "
                     "Default: tidak menghapus apa pun (CSV parsial = tambahan).")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
args = ap.parse_args()

if not os.path.isfile(args.file):
    sys.exit(f"file tidak ditemukan: {args.file}")

# Daftar gudang valid diambil dari DB, bukan dihardcode — kalau master gudang
# berubah (mis. PUSAT & KEMANGI ternyata sama lalu dinonaktifkan), importer ikut
# tanpa perlu diedit.
# `jenis = 'cabang'` WAJIB ikut: tanpa itu daftar valid memuat gudang VIRTUAL
# DI CUSTOMER, dan CSV yang berkolom kode gudang customer akan diterima — stok
# milik customer masuk ke tabel yang dibaca layar AM. Terbukti saat uji: sebelum
# gerbang ini ditambahkan, 'CUST-RS-A' muncul di daftar "gudang aktif".
res = subprocess.run([*PSQL, args.db, "-tAc",
                      "SELECT kode FROM warehouse WHERE aktif AND jenis = 'cabang' ORDER BY urutan"],
                     capture_output=True, text=True, encoding="utf-8")
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit("gagal membaca master `warehouse` (jenis=cabang) — sudah jalankan migrasi 082?")
WH = [k.strip() for k in res.stdout.splitlines() if k.strip()]
if not WH:
    sys.exit("tak ada gudang CABANG yang aktif di master `warehouse` — cek seed migrasi 082.")
print(f"== gudang cabang aktif di '{args.db}': {', '.join(WH)} ==")


def parse_qty(raw: str, ctx: str):
    """'' / whitespace → None (tak ada data). Angka → Decimal. Selain itu → abort.

    SENGAJA tidak menebak locale. Versi sebelumnya melakukan
    `.replace(".", "").replace(",", ".")` — memperlakukan setiap titik sebagai
    pemisah ribuan — sehingga CSV ber-locale en-US (default ekspor Google Sheets)
    merusak angka TANPA satu pun pesan:
        "1.5" → 15      "0.5" → 5      "1,234.56" → 1.23456
    Kolomnya numeric(16,2) jadi desimal memang wajar (meter/kg/liter), dan
    kesalahan 10× pada stok ikut memproduksi "anomali selisih negatif" yang
    katanya mustahil. Diam-diam salah jauh lebih buruk daripada menolak.

    Aturan sekarang:
      - ada KEDUA separator  → yang terakhir muncul = pemisah desimal
      - hanya ','            → pemisah desimal (format Indonesia)
      - hanya '.' + tepat 3 digit di belakangnya → AMBIGU ("1.500" bisa 1500 atau
        1,5) → ditolak, kecuali operator menyatakan konvensinya lewat --desimal
      - hanya '.' selain itu → pemisah desimal
    """
    s = (raw or "").strip().replace(" ", "").replace(" ", "")
    if s == "":
        return None
    neg = s.startswith("-")
    body = s[1:] if neg else s

    has_dot, has_comma = "." in body, "," in body
    if has_dot and has_comma:
        dec = "." if body.rfind(".") > body.rfind(",") else ","
        thou = "," if dec == "." else "."
        body = body.replace(thou, "").replace(dec, ".")
    elif has_comma:
        if body.count(",") > 1:
            sys.exit(f"qty ambigu pada {ctx}: {raw!r} — lebih dari satu koma")
        body = body.replace(",", ".")
    elif has_dot:
        if body.count(".") > 1:
            body = body.replace(".", "")  # 1.234.567 → jelas pemisah ribuan
        elif len(body.split(".")[1]) == 3:
            if args.desimal == "koma":
                body = body.replace(".", "")      # '.' = ribuan
            elif args.desimal == "titik":
                pass                              # '.' = desimal
            else:
                sys.exit(
                    f"qty ambigu pada {ctx}: {raw!r} — '.' diikuti 3 digit bisa berarti "
                    f"ribuan (1500) atau desimal (1,5). Jalankan ulang dengan "
                    f"--desimal koma (kalau '.' itu pemisah ribuan) atau "
                    f"--desimal titik (kalau '.' itu pemisah desimal)."
                )

    try:
        d = Decimal(("-" if neg else "") + body)
    except InvalidOperation:
        sys.exit(f"qty bukan angka pada {ctx}: {raw!r}")
    if not d.is_finite():
        sys.exit(f"qty bukan angka berhingga pada {ctx}: {raw!r}")
    if d < 0:
        sys.exit(f"qty negatif pada {ctx}: {raw!r} — stok tak boleh negatif")
    return d


rows_out = []  # (sku, gudang, qty)
kosong = 0

with io.open(args.file, encoding="utf-8-sig", newline="") as fh:
    rd = csv.DictReader(fh)
    raw_hdr = list(rd.fieldnames or [])
    if not raw_hdr:
        sys.exit("CSV tanpa header.")
    # `hdr` versi ter-strip untuk validasi, TAPI key DictReader adalah fieldname
    # ASLI. Dulu keduanya dicampur: header "sku, SBY" lolos pemeriksaan kolom
    # (karena di-strip dulu) lalu `r["SBY"]` melempar KeyError telanjang.
    hdr = [h.strip() for h in raw_hdr]
    asli = dict(zip(hdr, raw_hdr))

    if args.long:
        need = {"sku", "gudang", "qty"}
        if not need.issubset({h.lower() for h in hdr}):
            sys.exit(f"format --long butuh kolom sku,gudang,qty — ketemu: {hdr}")
        keymap = {h.lower(): asli[h] for h in hdr}
        for i, r in enumerate(rd, start=2):
            sku = (r[keymap["sku"]] or "").strip()
            gd = (r[keymap["gudang"]] or "").strip().upper()
            if not sku:
                continue
            if gd not in WH:
                sys.exit(f"baris {i}: gudang '{gd}' tak dikenal. Valid: {', '.join(WH)}")
            q = parse_qty(r[keymap["qty"]], f"baris {i} ({sku}/{gd})")
            if q is None:
                kosong += 1
                continue
            rows_out.append((sku, gd, q))
    else:
        if hdr[0].lower() != "sku":
            sys.exit(f"kolom pertama harus 'sku', ketemu '{hdr[0]}'")
        cols = hdr[1:]
        tak_dikenal = [c for c in cols if c.upper() not in WH]
        if tak_dikenal:
            sys.exit(f"kolom gudang tak dikenal: {tak_dikenal}. Valid: {', '.join(WH)}")
        # Kolom gudang duplikat: DictReader meruntuhkan key duplikat ke nilai
        # TERAKHIR, jadi "sku,SBY,SBY" membuang salah satu angka tanpa pesan
        # (dan pemeriksaan duplikat di bawah tak melihatnya, karena kedua
        # pembacaan mengembalikan nilai yang sama).
        ganda = sorted({c.upper() for c in cols if [x.upper() for x in cols].count(c.upper()) > 1})
        if ganda:
            sys.exit(f"kolom gudang muncul lebih dari sekali: {ganda} — gabungkan dulu di CSV")
        for i, r in enumerate(rd, start=2):
            sku = (r[asli[hdr[0]]] or "").strip()
            if not sku:
                continue
            for c in cols:
                q = parse_qty(r[asli[c]], f"baris {i} ({sku}/{c})")
                if q is None:
                    kosong += 1
                    continue
                rows_out.append((sku, c.upper(), q))

if not rows_out:
    sys.exit("tidak ada baris stok terbaca — semua sel kosong?")

# Sel kosong = "tidak ada data" (lihat docstring), TIDAK ditulis maupun dihapus.
# Tapi kombinasi dengan --hapus-tak-disebut berbahaya: kolom gudang yang cuma
# berisi sel kosong (mis. tim gudang belum opname cabang itu bulan ini) akan
# membuat DELETE menyapu SEMUA baris gudang tersebut di DB, padahal maksud
# operator cuma "belum ada angka baru", bukan "stoknya nol/kosong".
if args.hapus_tak_disebut and kosong:
    sys.exit(f"--hapus-tak-disebut dipakai bersama {kosong} sel qty KOSONG. "
             "Sel kosong tak akan ditulis, tapi --hapus-tak-disebut akan menghapus "
             "kombinasi (sku,gudang) itu dari DB seolah CSV bilang 'sudah dihitung, "
             "hasilnya nol' — padahal maksudnya 'belum diisi'. Isi sel itu dengan 0 "
             "bila memang stoknya nol, atau jalankan tanpa --hapus-tak-disebut.")

# SKU yang memuat newline/backslash DITOLAK sebelum apa pun dibangun.
#
# Ini bukan kerapian — ini lubang eksekusi SQL. Data dikirim lewat
# `\copy ... FROM STDIN`, dan psql mendeteksi terminator COPY di sisi KLIEN:
# baris yang isinya tepat `\.` mengakhiri data, dan psql TIDAK menghormati
# quoting CSV. Jadi sku ber-newline seperti
#     "PERF-1\n\.\nDROP TABLE item_stock_branch;\n\echo x"
# menghasilkan stream yang menutup COPY lalu menyuapkan DROP TABLE ke psql
# sebagai SQL — dan dengan --apply itu ikut COMMIT. CSV-nya datang dari tim
# gudang dan dijalankan terhadap wrg_os_prod.
for sku, gd, _q in rows_out:
    if any(ch in sku for ch in ("\n", "\r", "\\")):
        sys.exit(f"sku memuat newline/backslash — ditolak: {sku!r} (gudang {gd})")
    if any(ch in gd for ch in ("\n", "\r", "\\")):
        sys.exit(f"kode gudang memuat newline/backslash — ditolak: {gd!r}")

# Duplikat (sku,gudang) di dalam SATU file = ambigu, tolak. Kalau dibiarkan,
# yang menang tergantung urutan baris dan hasilnya tak bisa direproduksi.
seen = {}
for sku, gd, q in rows_out:
    k = (sku, gd)
    if k in seen and seen[k] != q:
        sys.exit(f"duplikat (sku,gudang) dgn nilai beda di CSV: {sku}/{gd} → {seen[k]} vs {q}")
    seen[k] = q

# Data dikirim INLINE lewat `\copy ... FROM STDIN`, bukan file temporer.
# Alasannya bukan cuma rapi: `\copy FROM '<path>'` menaruh path apa adanya di
# dalam string SQL, dan path Windows (C:\Users\…) langsung rusak karena
# backslash. Lewat STDIN importer ini jalan sama di Mac maupun Windows, dan tak
# ada file sisa kalau proses mati di tengah.
buf = io.StringIO()
w = csv.writer(buf, lineterminator="\n")
w.writerow(["sku", "warehouse_kode", "quantity"])
for (sku, gd), q in seen.items():
    w.writerow([sku, gd, q])
stg_csv = buf.getvalue()

print(f"  baris stok terbaca : {len(seen)}  (sel kosong dilewati: {kosong})")

hapus_sql = ""
if args.hapus_tak_disebut:
    # DITAMBAH klausa `sb.warehouse_kode IN (SELECT ... FROM stg)`.
    # Tanpa itu, DELETE menyapu SEMUA gudang yang kebetulan tak berkolom di CSV:
    # CSV opname satu cabang (mis. hanya kolom SBY) menghapus seluruh
    # Jember/Lamongan/Tuban/Kediri/NTT — terukur 10.443 dari 13.923 baris di DB
    # uji, termasuk koreksi source='manual' dan baris gudang nonaktif.
    # Sekarang cakupannya cuma gudang yang benar-benar dilaporkan CSV itu.
    hapus_sql = """
-- Baris stok yang TIDAK disebut CSV → dihapus (opsi --hapus-tak-disebut),
-- TERBATAS pada gudang yang kolomnya hadir di CSV ini.
\\echo '--- akan DIHAPUS (gudang yang dilaporkan CSV, kombinasi tak disebut) ---'
SELECT 'akan_dihapus=' || count(*) FROM item_stock_branch sb
 WHERE sb.warehouse_kode IN (SELECT DISTINCT warehouse_kode FROM stg)
   AND NOT EXISTS (
     SELECT 1 FROM stg s JOIN accurate_item ai ON ai.no = s.sku
      WHERE ai.id = sb.item_id AND s.warehouse_kode = sb.warehouse_kode);

DELETE FROM item_stock_branch sb
 WHERE sb.warehouse_kode IN (SELECT DISTINCT warehouse_kode FROM stg)
   AND NOT EXISTS (
     SELECT 1 FROM stg s JOIN accurate_item ai ON ai.no = s.sku
      WHERE ai.id = sb.item_id AND s.warehouse_kode = sb.warehouse_kode);
"""

sql = f"""
CREATE TEMP TABLE stg (sku text, warehouse_kode text, quantity numeric) ON COMMIT DROP;
\\copy stg FROM STDIN WITH (FORMAT csv, HEADER true)
{stg_csv}\\.

\\echo '--- SKU di CSV yang TIDAK ada di accurate_item (ditolak) ---'
SELECT DISTINCT s.sku FROM stg s
 WHERE NOT EXISTS (SELECT 1 FROM accurate_item ai WHERE ai.no = s.sku)
 ORDER BY 1 LIMIT 50;
SELECT 'sku_ditolak=' || count(DISTINCT s.sku) FROM stg s
 WHERE NOT EXISTS (SELECT 1 FROM accurate_item ai WHERE ai.no = s.sku);
-- Dipakai skrip untuk memutuskan abort: kalau NOL baris cocok, seluruh CSV
-- percuma (mis. format/casing SKU beda) — jangan sampai skrip mencetak
-- "TERSIMPAN" dan exit 0 seolah berhasil.
SELECT 'baris_cocok=' || count(*) FROM stg s
  JOIN accurate_item ai ON ai.no = s.sku;

-- ABORT DI DALAM TRANSAKSI kalau tak ada satu pun SKU yang cocok.
--
-- Dulu cek ini dilakukan di Python SETELAH psql selesai — jadi terlalu terlambat:
-- body-nya sudah COMMIT. Dengan `--hapus-tak-disebut`, CSV yang kolom `sku`-nya
-- salah format seluruhnya membuat NOT EXISTS bernilai true untuk SEMUA baris →
-- seluruh gudang yang dilaporkan CSV itu TERHAPUS dan ter-COMMIT, lalu skrip
-- mencetak "tak ada yang ditulis".
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM stg s JOIN accurate_item ai ON ai.no = s.sku;
  IF n = 0 THEN
    RAISE EXCEPTION 'tidak ada satu pun SKU di CSV yang cocok dengan accurate_item — dibatalkan (tak ada yang ditulis maupun dihapus)';
  END IF;
END $$;

INSERT INTO item_stock_branch (item_id, warehouse_kode, quantity, source, updated_at)
SELECT ai.id, s.warehouse_kode, s.quantity, '{args.source}', now()
  FROM stg s JOIN accurate_item ai ON ai.no = s.sku
ON CONFLICT (item_id, warehouse_kode) DO UPDATE SET
  quantity = EXCLUDED.quantity, source = EXCLUDED.source, updated_at = now();
{hapus_sql}
\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'baris_stok_total=' || count(*) FROM item_stock_branch;
SELECT w.kode || ': item=' || count(sb.item_id) || ' qty=' || COALESCE(sum(sb.quantity),0)
  FROM warehouse w LEFT JOIN item_stock_branch sb ON sb.warehouse_kode = w.kode
 GROUP BY w.kode, w.urutan ORDER BY w.urutan;
\\echo '--- KORELASI ke total Accurate (selisih = tanda data cabang belum lengkap) ---'
WITH per_item AS (
  SELECT ai.id, ai.quantity, count(sb.warehouse_kode) AS n, COALESCE(sum(sb.quantity),0) AS cab
    FROM accurate_item ai LEFT JOIN item_stock_branch sb ON sb.item_id = ai.id
   GROUP BY ai.id, ai.quantity)
SELECT 'item_mirror=' || count(*) || ' ada_data=' || count(*) FILTER (WHERE n>0)
    || ' tanpa_data=' || count(*) FILTER (WHERE n=0)
    || ' selisih=' || count(*) FILTER (WHERE n>0 AND COALESCE(quantity,0) <> cab)
  FROM per_item;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print("== DB (staging load + upsert + laporan; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
# encoding="utf-8" WAJIB: tanpa itu Python meng-encode stdin memakai encoding
# locale (cp1252 di Windows) dan importer mati dengan UnicodeEncodeError begitu
# body SQL atau data CSV memuat karakter non-Latin1 — termasuk nama SKU beraksen.
res = subprocess.run([*PSQL, args.db, "-v", "ON_ERROR_STOP=1"], input=body,
                     capture_output=True, text=True, encoding="utf-8")
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)

# Abort kalau TIDAK ADA satu pun baris yang cocok ke accurate_item. Tanpa ini
# skrip mencetak "TERSIMPAN ... " dan exit 0 padahal 0 baris ditulis — kegagalan
# yang paling gampang tidak disadari, karena `sku_ditolak=<N>` lewat di tengah
# output psql yang panjang.
cocok = None
for line in res.stdout.splitlines():
    if "baris_cocok=" in line:
        try:
            cocok = int(line.split("baris_cocok=")[1].strip().rstrip("|").strip())
        except (ValueError, IndexError):
            pass
if cocok == 0:
    sys.exit("\nGAGAL: tidak ada satu pun SKU di CSV yang cocok dengan accurate_item — "
             "tak ada yang ditulis. Cek format/casing kolom sku, dan pastikan mirror item "
             "sudah disinkron (POST /accurate/sync/items).")
if cocok is not None:
    print(f"  baris cocok ke item : {cocok}")

print(f"== {'TERSIMPAN ke' if args.apply else 'DRY-RUN (tidak menulis apa pun) —'} database "
      f"'{args.db}', source='{args.source}' ==")
if not args.apply:
    print("   tambahkan --apply untuk benar-benar menyimpan.")
