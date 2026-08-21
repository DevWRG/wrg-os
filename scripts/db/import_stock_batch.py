#!/usr/bin/env python3
"""F38 ED Watch importer — CSV batch/ED tim gudang → `item_stock_batch`.

Kenapa importer, bukan form: sama alasannya dengan F37 — data batch & ED hidup di
Excel tim gudang. Seed HR (053_seed_employee_spine.sql) merekam pengakuan mereka
sendiri: "dokumen SP/SJ (manual lot-ED)", "Akurasi stok & lot-ED", KPI
"Barang expired → 0".

Bentuk CSV (LONG — satu baris per batch, karena satu SKU bisa punya banyak batch
di gudang yang sama; format WIDE tidak masuk untuk data ini):

    sku,gudang,batch,ed,qty
    IDS.0276,SBY,B2408-01,2026-11-30,120
    IDS.0276,SBY,B2409-07,2027-02-14,80
    IDS.0301,JEMBER,L-5521,,45          <- ed kosong = barang non-kedaluwarsa

  - `sku`    dicocokkan ke `accurate_item.no`; yang tak dikenal DITOLAK.
  - `gudang` harus kode `warehouse` yang AKTIF dan **jenis='cabang'** — gudang
    virtual di customer tak diterima (arahan Direktur).
  - `batch`  teks bebas (format beda per prinsipal, tak ada master batch).
  - `ed`     YYYY-MM-DD, boleh KOSONG untuk barang non-kedaluwarsa. Baris ber-ED
             kosong TIDAK ikut alert — bukan dianggap "sudah lewat".
  - `qty`    angka; aturan desimal sama dengan importer F37 (lihat --desimal).

Idempoten: kunci (item_id, warehouse_kode, batch_no) → re-import = UPDATE.

⚠️ ED yang MAJU me-reset penanda alert. Kalau tanggal ED sebuah batch diperbaiki
jadi lebih jauh, `alert_tier_terkirim` dikosongkan supaya ambangnya berbunyi
ulang dari awal — kalau tidak, batch itu tak akan pernah diperingatkan lagi
meski nanti mendekat kembali.

Pakai:
  python3 import_stock_batch.py --file <csv> --db <wrg_os|wrg_os_prod> [--desimal koma|titik] [--apply]
  default = DRY-RUN (BEGIN + ROLLBACK; cuma laporan, TIDAK menulis).

Tanpa `psql` native (dev Windows, DB di Docker):
  PSQL_BIN="docker compose exec -T postgres psql -U wrg" \\
    python3 import_stock_batch.py --file batch.csv --db wrg_os
"""
import argparse, csv, io, os, shlex, subprocess, sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

# Tanggal WIB — laporan sebaran ambang harus memakai patokan yang SAMA dengan
# aplikasi (repo/stock-batch.ts hariIniWib). `current_date` mengikuti timezone
# container Postgres (Etc/UTC), jadi import antara 00:00-07:00 WIB menghasilkan
# laporan yang bergeser sehari dari angka di kartu — bahan salah paham yang
# gampang muncul dan susah dilacak.
hari_ini_wib = (datetime.now(timezone.utc) + timedelta(hours=7)).date().isoformat()

PSQL = shlex.split(os.environ.get("PSQL_BIN", "psql"))

ap = argparse.ArgumentParser()
ap.add_argument("--file", required=True, help="CSV batch/ED per gudang")
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os / wrg_os_prod")
ap.add_argument("--source", default="import", choices=["import", "manual"])
ap.add_argument("--desimal", choices=["koma", "titik"],
                help="konvensi desimal CSV bila ada nilai ambigu seperti '1.500'. "
                     "Tanpa ini nilai ambigu DITOLAK.")
ap.add_argument("--hapus-tak-disebut", action="store_true",
                help="hapus baris batch yang TIDAK ada di CSV — TERBATAS pada "
                     "kombinasi (gudang) yang hadir di CSV itu. Default: tidak menghapus.")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
args = ap.parse_args()

if not os.path.isfile(args.file):
    sys.exit(f"file tidak ditemukan: {args.file}")

# Gudang valid: AKTIF dan jenis='cabang'. Gerbang jenis WAJIB — tanpa itu CSV
# berkolom kode gudang VIRTUAL DI CUSTOMER akan diterima, dan stok milik customer
# ikut ter-alert ke tim gudang. Sama seperti importer F37.
res = subprocess.run([*PSQL, args.db, "-tAc",
                      "SELECT kode FROM warehouse WHERE aktif AND jenis = 'cabang' ORDER BY urutan"],
                     capture_output=True, text=True, encoding="utf-8")
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit("gagal membaca master `warehouse` (jenis=cabang) — sudah jalankan migrasi 082?")
WH = [k.strip() for k in res.stdout.splitlines() if k.strip()]
if not WH:
    sys.exit("tak ada gudang CABANG yang aktif — cek seed migrasi 082.")
print(f"== gudang cabang aktif di '{args.db}': {', '.join(WH)} ==")


def parse_qty(raw, ctx):
    """Aturan desimal identik importer F37 — locale TIDAK ditebak."""
    s = (raw or "").strip().replace(" ", "").replace(" ", "")
    if s == "":
        return None
    neg = s.startswith("-")
    body = s[1:] if neg else s
    has_dot, has_comma = "." in body, "," in body
    if has_dot and has_comma:
        dec = "." if body.rfind(".") > body.rfind(",") else ","
        body = body.replace("," if dec == "." else ".", "").replace(dec, ".")
    elif has_comma:
        if body.count(",") > 1:
            sys.exit(f"qty ambigu pada {ctx}: {raw!r} — lebih dari satu koma")
        body = body.replace(",", ".")
    elif has_dot:
        if body.count(".") > 1:
            body = body.replace(".", "")
        elif len(body.split(".")[1]) == 3:
            if args.desimal == "koma":
                body = body.replace(".", "")
            elif args.desimal != "titik":
                sys.exit(f"qty ambigu pada {ctx}: {raw!r} — '.' diikuti 3 digit bisa berarti "
                         f"ribuan (1500) atau desimal (1,5). Pakai --desimal koma|titik.")
    try:
        d = Decimal(("-" if neg else "") + body)
    except InvalidOperation:
        sys.exit(f"qty bukan angka pada {ctx}: {raw!r}")
    if not d.is_finite():
        sys.exit(f"qty bukan angka berhingga pada {ctx}: {raw!r}")
    if d < 0:
        sys.exit(f"qty negatif pada {ctx}: {raw!r} — stok tak boleh negatif")
    return d


def parse_ed(raw, ctx):
    """'' → None (barang non-kedaluwarsa). Selain itu WAJIB YYYY-MM-DD yang benar.

    Regex saja tidak cukup: '2026-13-45' lolos pola tapi mati di cast ::date, dan
    error-nya muncul sebagai kegagalan psql di tengah output — jauh dari nomor
    baris CSV yang menyebabkannya. Divalidasi di sini supaya pesannya menyebut
    baris & SKU-nya.
    """
    s = (raw or "").strip()
    if s == "":
        return None
    parts = s.split("-")
    if len(parts) != 3 or len(parts[0]) != 4 or len(parts[1]) != 2 or len(parts[2]) != 2:
        sys.exit(f"ed harus YYYY-MM-DD pada {ctx}: {raw!r}")
    try:
        d = date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError as e:
        sys.exit(f"ed bukan tanggal yang ada pada {ctx}: {raw!r} ({e})")
    if d.year < 2000 or d.year > 2100:
        sys.exit(f"ed di luar rentang wajar pada {ctx}: {raw!r} — cek salah ketik tahun")
    return d.isoformat()


rows_out = []
kosong_qty = 0
tanpa_ed = 0

with io.open(args.file, encoding="utf-8-sig", newline="") as fh:
    rd = csv.DictReader(fh)
    raw_hdr = list(rd.fieldnames or [])
    if not raw_hdr:
        sys.exit("CSV tanpa header.")
    hdr = [h.strip().lower() for h in raw_hdr]
    asli = dict(zip(hdr, raw_hdr))
    wajib = {"sku", "gudang", "batch", "ed", "qty"}
    if not wajib.issubset(set(hdr)):
        sys.exit(f"CSV butuh kolom sku,gudang,batch,ed,qty — ketemu: {hdr}")
    ganda = sorted({h for h in hdr if hdr.count(h) > 1})
    if ganda:
        sys.exit(f"kolom muncul lebih dari sekali: {ganda} — gabungkan dulu di CSV")

    for i, r in enumerate(rd, start=2):
        sku = (r[asli["sku"]] or "").strip()
        if not sku:
            continue
        gd = (r[asli["gudang"]] or "").strip().upper()
        if gd not in WH:
            sys.exit(f"baris {i}: gudang '{gd}' bukan gudang cabang aktif. Valid: {', '.join(WH)}")
        batch = (r[asli["batch"]] or "").strip()
        if not batch:
            sys.exit(f"baris {i} ({sku}/{gd}): kolom batch wajib diisi")
        ctx = f"baris {i} ({sku}/{gd}/{batch})"
        ed = parse_ed(r[asli["ed"]], ctx)
        if ed is None:
            tanpa_ed += 1
        qty = parse_qty(r[asli["qty"]], ctx)
        if qty is None:
            kosong_qty += 1
            continue
        rows_out.append((sku, gd, batch, ed, qty))

if not rows_out:
    sys.exit("tidak ada baris batch terbaca — semua qty kosong?")

# Baris ber-qty KOSONG dilewati (tak masuk stg), jadi dengan --hapus-tak-disebut
# baris DB-nya ikut terhapus MESKI CSV menyebutnya lengkap dengan ED-nya. Untuk
# F38 yang hilang termasuk ED + penanda alert. Kombinasi itu hampir pasti bukan
# yang dimaksud operator, jadi ditolak — bukan dijalankan diam-diam.
if args.hapus_tak_disebut and kosong_qty:
    sys.exit(f"--hapus-tak-disebut dipakai bersama {kosong_qty} baris ber-qty KOSONG. "
             f"Baris seperti itu tidak masuk staging, jadi batch-nya akan DIHAPUS meski "
             f"disebut di CSV (ED & penanda alert ikut hilang). Isi qty-nya (0 kalau memang "
             f"habis) atau jalankan tanpa --hapus-tak-disebut.")

# Newline/backslash di field teks DITOLAK sebelum stream dibangun: `\copy FROM
# STDIN` mendeteksi terminator COPY di sisi KLIEN (baris berisi tepat `\.`) dan
# TIDAK menghormati quoting CSV, jadi field ber-newline bisa menutup COPY lalu
# menyuapkan SQL sembarang ke psql — dan dengan --apply itu ikut COMMIT.
for sku, gd, batch, _ed, _q in rows_out:
    for label, val in (("sku", sku), ("gudang", gd), ("batch", batch)):
        if any(ch in val for ch in ("\n", "\r", "\\")):
            sys.exit(f"{label} memuat newline/backslash — ditolak: {val!r}")

# Duplikat (sku,gudang,batch) bernilai beda = ambigu; kalau dibiarkan, yang
# menang tergantung urutan baris dan hasilnya tak bisa direproduksi.
seen = {}
for sku, gd, batch, ed, q in rows_out:
    k = (sku, gd, batch)
    if k in seen and seen[k] != (ed, q):
        sys.exit(f"duplikat (sku,gudang,batch) dgn nilai beda di CSV: {sku}/{gd}/{batch} "
                 f"→ {seen[k]} vs {(ed, q)}")
    seen[k] = (ed, q)

buf = io.StringIO()
w = csv.writer(buf, lineterminator="\n")
w.writerow(["sku", "warehouse_kode", "batch_no", "ed_date", "quantity"])
for (sku, gd, batch), (ed, q) in seen.items():
    w.writerow([sku, gd, batch, ed if ed is not None else "", q])
stg_csv = buf.getvalue()

print(f"  baris batch terbaca : {len(seen)}  (qty kosong dilewati: {kosong_qty}, tanpa ED: {tanpa_ed})")

hapus_sql = ""
if args.hapus_tak_disebut:
    hapus_sql = """
-- Batch yang TIDAK disebut CSV → dihapus, TERBATAS pada gudang yang hadir di CSV
-- ini (pelajaran F37: tanpa batasan itu, CSV opname satu cabang menyapu gudang
-- lain — terukur 10.443 dari 13.923 baris).
\\echo '--- akan DIHAPUS (gudang yang dilaporkan CSV, batch tak disebut) ---'
SELECT 'akan_dihapus=' || count(*) FROM item_stock_batch sb
 WHERE sb.warehouse_kode IN (SELECT DISTINCT warehouse_kode FROM stg)
   AND NOT EXISTS (
     SELECT 1 FROM stg s JOIN accurate_item ai ON ai.no = s.sku
      WHERE ai.id = sb.item_id AND s.warehouse_kode = sb.warehouse_kode
        AND s.batch_no = sb.batch_no);

DELETE FROM item_stock_batch sb
 WHERE sb.warehouse_kode IN (SELECT DISTINCT warehouse_kode FROM stg)
   AND NOT EXISTS (
     SELECT 1 FROM stg s JOIN accurate_item ai ON ai.no = s.sku
      WHERE ai.id = sb.item_id AND s.warehouse_kode = sb.warehouse_kode
        AND s.batch_no = sb.batch_no);
"""

sql = f"""
CREATE TEMP TABLE stg (sku text, warehouse_kode text, batch_no text, ed_date date, quantity numeric)
  ON COMMIT DROP;
\\copy stg FROM STDIN WITH (FORMAT csv, HEADER true)
{stg_csv}\\.

\\echo '--- SKU di CSV yang TIDAK ada di accurate_item (ditolak) ---'
SELECT DISTINCT s.sku FROM stg s
 WHERE NOT EXISTS (SELECT 1 FROM accurate_item ai WHERE ai.no = s.sku)
 ORDER BY 1 LIMIT 50;
SELECT 'sku_ditolak=' || count(DISTINCT s.sku) FROM stg s
 WHERE NOT EXISTS (SELECT 1 FROM accurate_item ai WHERE ai.no = s.sku);
SELECT 'baris_cocok=' || count(*) FROM stg s JOIN accurate_item ai ON ai.no = s.sku;

-- ABORT DI DALAM TRANSAKSI kalau tak ada satu pun SKU yang cocok.
--
-- Dulu cek ini dilakukan di Python SETELAH psql selesai — jadi terlalu terlambat:
-- body-nya sudah COMMIT. Dengan `--hapus-tak-disebut`, CSV yang kolom `sku`-nya
-- salah format seluruhnya (kolom `gudang` divalidasi terpisah, jadi tetap lolos)
-- membuat NOT EXISTS bernilai true untuk SEMUA baris → seluruh batch gudang itu
-- TERHAPUS dan ter-COMMIT, lalu skrip mencetak "tak ada yang ditulis". Terukur
-- di DB uji: 11 baris hilang sementara pesannya mengatakan tidak ada perubahan.
-- Yang hilang termasuk ED manual dan penanda alert yang tak punya sumber lain.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM stg s JOIN accurate_item ai ON ai.no = s.sku;
  IF n = 0 THEN
    RAISE EXCEPTION 'tidak ada satu pun SKU di CSV yang cocok dengan accurate_item — dibatalkan (tak ada yang ditulis maupun dihapus)';
  END IF;
END $$;

INSERT INTO item_stock_batch
  (item_id, warehouse_kode, batch_no, ed_date, quantity, source, updated_at)
SELECT ai.id, s.warehouse_kode, s.batch_no, s.ed_date, s.quantity, '{args.source}', now()
  FROM stg s JOIN accurate_item ai ON ai.no = s.sku
ON CONFLICT (item_id, warehouse_kode, batch_no) DO UPDATE SET
  ed_date = EXCLUDED.ed_date,
  quantity = EXCLUDED.quantity,
  source = EXCLUDED.source,
  -- ED MAJU → reset penanda alert supaya ambangnya berbunyi ulang. Tanpa ini,
  -- batch yang ED-nya diperbaiki jadi lebih jauh tak akan pernah diperingatkan
  -- lagi walau nanti mendekat kembali (tier tercatat sudah kecil).
  -- ED mundur/sama → penanda dipertahankan, jadi tak ada spam pengulangan.
  -- Reset penanda alert kalau ED "menjauh" — termasuk kasus ED sebelumnya NULL.
  -- Versi awal mewajibkan KEDUA sisi NOT NULL, sehingga rantai ini bocor: batch
  -- dialert di tier 30 → gudang re-upload dengan kolom `ed` kosong (kelalaian
  -- umum; diterima sebagai "barang non-kedaluwarsa") → ED jadi NULL tapi penanda
  -- tetap 30 → CSV berikutnya mengisi ED yang benar → TIDAK ter-reset, dan batch
  -- itu tak akan pernah diperingatkan lagi. Sekarang: ED lama NULL + ED baru ada
  -- juga dihitung sebagai menjauh.
  alert_tier_terkirim = CASE
    WHEN EXCLUDED.ed_date IS NOT NULL
         AND (item_stock_batch.ed_date IS NULL
              OR EXCLUDED.ed_date > item_stock_batch.ed_date) THEN NULL
    ELSE item_stock_batch.alert_tier_terkirim END,
  alert_terkirim_at = CASE
    WHEN EXCLUDED.ed_date IS NOT NULL
         AND (item_stock_batch.ed_date IS NULL
              OR EXCLUDED.ed_date > item_stock_batch.ed_date) THEN NULL
    ELSE item_stock_batch.alert_terkirim_at END,
  updated_at = now();
{hapus_sql}
\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'baris_batch_total=' || count(*) FROM item_stock_batch;
SELECT 'tanpa_ed=' || count(*) FROM item_stock_batch WHERE ed_date IS NULL;
\\echo '--- Sebaran ambang (dari hari ini) ---'
SELECT CASE WHEN ed_date IS NULL THEN 'tanpa ED'
            WHEN ed_date < '{hari_ini_wib}'::date THEN 'SUDAH LEWAT'
            WHEN ed_date <= '{hari_ini_wib}'::date + 30 THEN '<= 30 hari'
            WHEN ed_date <= '{hari_ini_wib}'::date + 60 THEN '31-60 hari'
            WHEN ed_date <= '{hari_ini_wib}'::date + 90 THEN '61-90 hari'
            ELSE '> 90 hari' END AS ambang,
       count(*) AS batch, COALESCE(sum(quantity),0) AS qty
  FROM item_stock_batch GROUP BY 1 ORDER BY 1;
"""

body = "BEGIN;\n" + sql + ("\nCOMMIT;\n" if args.apply else "\nROLLBACK;\n")
print("== DB (staging load + upsert + laporan; " + ("COMMIT" if args.apply else "ROLLBACK") + ") ==")
res = subprocess.run([*PSQL, args.db, "-v", "ON_ERROR_STOP=1"], input=body,
                     capture_output=True, text=True, encoding="utf-8")
sys.stdout.write(res.stdout)
if res.returncode != 0:
    sys.stderr.write(res.stderr)
    sys.exit(1)

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
