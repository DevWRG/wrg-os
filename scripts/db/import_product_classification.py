#!/usr/bin/env python3
"""Importer klasifikasi produk + kode produk (migrasi 072).

Sumber: Google Sheet "3. PL Product Compilation"
  - sheet `DB_Product`                  → master taxonomy 4 level
  - sheet `Business Medical`            → produk ber-price-list Medical
  - sheet `Business IVD`                → produk ber-price-list IVD
  - sheet `Kroscek mapping Saldo Awal`  → seluruh master produk existing

Data TIDAK di-commit — repo ini PUBLIC. Export tiap sheet ke CSV lalu tunjuk
file-nya. Hanya stdlib (tanpa openpyxl) supaya bisa jalan di mesin prod apa adanya.

Kode yang diterbitkan: KK.PP.CC.SSS.NNNN. Berbeda dari generator spreadsheet
dalam 3 hal, sengaja (lihat komentar migrasi 072):
  1. Resolusi HIRARKIS — Class dicari di dalam kategorinya, Sub Class di dalam
     (class, kategori)-nya. VLOOKUP di sheet mencocokkan nama saja, jadi nama
     kembar (4 Class + 33 Sub Class) mengambil id kategori lain.
  2. Sub Class SELALU 3 digit (sheet Kroscek memakai 2 digit → 491 produk dengan
     id >= 100 kepotong).
  3. Nomor urut NNNN global per prefix KK.PP.CC.SSS lintas semua sumber, bukan
     per-sheet (counter per-sheet sempat menerbitkan kode kembar).

Idempoten lewat kolom `identitas`:
  'K:<kode 2025>' bila produk punya kode Accurate berjalan, kalau tidak
  'N:<NAMA ACCURATE 2026>'. Produk yang sudah punya kode TIDAK diberi kode baru
  saat re-import, dan nomor urut baru selalu melanjutkan yang sudah ada di DB.
  Bentuk 'N:' diakui rawan (satu nama bisa dipakai beberapa produk berbeda) —
  importer melaporkan jumlah baris yang digabung atas dasar nama.

Baris yang klasifikasinya belum terdaftar di master TIDAK diberi kode tebakan
(kode menempel permanen di Accurate) — masuk `product_code_review` untuk
diputuskan HoD Business.

Pakai:
  python3 import_product_classification.py \\
      --db-product <DB_Product.csv> \\
      --produk "Business Medical=<file.csv>" \\
      --produk "Business IVD=<file.csv>" \\
      --produk "Kroscek mapping Saldo Awal=<file.csv>" \\
      --db <wrg_os_dev|wrg_os_prod> [--apply]

  default = DRY-RUN (BEGIN … ROLLBACK; FK & CHECK tetap diuji sungguhan).
  Urutan --produk menentukan urutan nomor NNNN — pakai urutan yang sama setiap
  kali supaya kode tidak bergeser antar-jalan.
"""
import argparse, csv, os, subprocess, sys, tempfile
from collections import Counter, OrderedDict

# ── argumen ────────────────────────────────────────────────────────────────
ap = argparse.ArgumentParser()
ap.add_argument("--db-product", required=True, help="CSV export sheet DB_Product (master taxonomy)")
ap.add_argument("--produk", action="append", default=[], metavar="LABEL=FILE",
                help="CSV export sheet produk; boleh diulang. LABEL disimpan di kolom sumber.")
# Wajib disebut, tanpa default: 'berhasil' ke database yang salah adalah kegagalan
# yang paling gampang tidak disadari (sudah kejadian di importer price book).
ap.add_argument("--db", required=True, help="nama database target, mis. wrg_os_dev / wrg_os_prod")
ap.add_argument("--apply", action="store_true", help="commit (default dry-run rollback)")
ap.add_argument("--daftarkan-master", action="store_true",
                help="daftarkan Class/Sub Class yang belum ada ke master (nomor melanjutkan "
                     "yang terbesar di induknya) alih-alih menahan produknya. Pakai hanya "
                     "kalau sumbernya otoritatif — id yang terbit permanen.")
ap.add_argument("--review-gabung-nama", action="store_true",
                help="ikut catat baris yang digabung karena nama sama ke product_code_review")
args = ap.parse_args()

pad = lambda v, n: str(v).strip().zfill(n)
# Rapatkan semua deret whitespace jadi satu spasi — BUKAN sekadar strip(). Beberapa
# sel sheet berisi newline di tengah nama produk; kalau lolos, nilai `identitas`
# ikut ber-newline dan pembacaan hasil psql (satu baris = satu record) pecah.
clean = lambda v: " ".join(str(v or "").split())
low = lambda v: clean(v).lower()


def baca_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [row for row in csv.reader(f)]


def kolom_index(rows, wajib, maks_baris=6):
    """Cari baris header (posisinya beda per sheet: Business di baris 2, Kroscek di
    baris 1) lalu petakan nama kolom → indeks. Nama kolom yang muncul dua kali
    (Kroscek punya blok bantu 'Kategori/Product Line/Class/Sub Class' lagi di
    kolom O–R yang isinya id hasil VLOOKUP) diambil yang PERTAMA."""
    for i, row in enumerate(rows[:maks_baris]):
        nama = [clean(c) for c in row]
        idx = {}
        for j, n in enumerate(nama):
            if n and n not in idx:
                idx[n] = j
        if all(w in idx for w in wajib):
            return i, idx
    sys.exit(f"header tidak ketemu (butuh {wajib}) di {maks_baris} baris pertama")


# ── 1. master taxonomy dari sheet DB_Product ───────────────────────────────
# Empat blok berdampingan dalam satu sheet. Diambil lewat nama header, bukan
# posisi kolom, supaya tidak patah kalau kolom bantu di sheet bergeser.
rows = baca_csv(args.db_product)
_, ix = kolom_index(rows, ["Nama Kategori", "id_kategori", "Nama Product Line",
                           "id_product_line", "Nama Class", "id_class",
                           "Nama Sub Class", "id_sub_class"])
# 'id_kategori' muncul 3x (blok kategori, product line, class) dan 'id_class' 2x
# (blok class, sub class) — kolom_index mengambil yang pertama, jadi blok
# product line / class / sub class dicari relatif terhadap kolom namanya.
c_kat_nama, c_kat_id = ix["Nama Kategori"], ix["id_kategori"]
c_pl_nama = ix["Nama Product Line"]; c_pl_id = ix["id_product_line"]; c_pl_kat = c_pl_id + 1
c_cl_nama = ix["Nama Class"]; c_cl_id = ix["id_class"]; c_cl_kat = c_cl_id + 1
c_sc_nama = ix["Nama Sub Class"]; c_sc_id = ix["id_sub_class"]
c_sc_cl = c_sc_id + 1; c_sc_kat = c_sc_id + 2

kat, line, klas, sub = OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict()
for row in rows[1:]:
    g = lambda j: clean(row[j]) if j < len(row) else ""
    if g(c_kat_nama):
        kat[pad(g(c_kat_id), 2)] = g(c_kat_nama)
    if g(c_pl_nama):
        line[(pad(g(c_pl_kat), 2), pad(g(c_pl_id), 2))] = g(c_pl_nama)
    if g(c_cl_nama):
        klas[(pad(g(c_cl_kat), 2), pad(g(c_cl_id), 2))] = g(c_cl_nama)
    if g(c_sc_nama):
        sub[(pad(g(c_sc_kat), 2), pad(g(c_sc_cl), 2), pad(g(c_sc_id), 3))] = g(c_sc_nama)

# Induk yang tidak ada = master rusak; jangan diteruskan (FK akan menolak juga,
# tapi pesan psql-nya jauh lebih sulit dibaca).
yatim = [k for k in line if k[0] not in kat] + [k for k in klas if k[0] not in kat]
yatim += [k for k in sub if (k[0], k[1]) not in klas]
if yatim:
    sys.exit(f"master taxonomy rusak, induk tidak ada: {yatim[:10]} ({len(yatim)} entri)")

# Indeks resolusi hirarkis: (nama, induk) → id.
KAT_BY_NAMA = {low(v): k for k, v in kat.items()}
LINE_BY_NAMA = {(low(v), k[0]): k[1] for k, v in line.items()}
CLASS_BY_NAMA = {(low(v), k[0]): k[1] for k, v in klas.items()}
SUB_BY_NAMA = {(low(v), k[0], k[1]): k[2] for k, v in sub.items()}

# ── auto-daftar node master yang belum ada (--daftarkan-master) ────────────
# Dipakai saat sumbernya memang otoritatif (mis. file Compilation FINAL) dan
# menahan produk tanpa kode lebih merugikan daripada menambah node master.
# Nomornya MELANJUTKAN nomor terbesar di induknya, tidak pernah mengisi lubang:
# id yang pernah terbit ikut ke kode produk dan menempel permanen di Accurate,
# jadi mendaur-ulang nomor bekas berarti dua produk berbeda bisa berbagi kode.
# Semua yang dibuat dicatat & dilaporkan supaya HoD Business bisa memeriksa.
node_baru = []


def daftar_baru(level, kid, cid, nama):
    nama = clean(nama)
    if level == "class":
        urut = max((int(k[1]) for k in klas if k[0] == kid), default=0) + 1
        if urut > 99:
            return None
        nid = f"{urut:02d}"
        klas[(kid, nid)] = nama
        CLASS_BY_NAMA[(low(nama), kid)] = nid
    else:
        urut = max((int(k[2]) for k in sub if k[0] == kid and k[1] == cid), default=0) + 1
        if urut > 999:
            return None
        nid = f"{urut:03d}"
        sub[(kid, cid, nid)] = nama
        SUB_BY_NAMA[(low(nama), kid, cid)] = nid
    node_baru.append((level, kid, cid, nid, nama))
    return nid

# ── 2. keadaan DB sekarang (kode yang sudah terbit) ────────────────────────
def psql_baca(sql):
    res = subprocess.run(["psql", args.db, "-tAF", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        sys.exit(f"gagal membaca database '{args.db}'")
    out = []
    for l in res.stdout.splitlines():
        if not l.strip():
            continue
        out.append(l.split("\t"))
    return out


ada_tabel = psql_baca("SELECT to_regclass('public.product_code') IS NOT NULL")[0][0] == "t"
if not ada_tabel:
    sys.exit(f"tabel product_code belum ada di '{args.db}' — jalankan migrasi 072 dulu "
             f"(infra/postgres/init/072_product_classification.sql)")

# Master di DB DILEBUR ke master dari CSV sebelum apa pun dinomori. Tanpa ini,
# --daftarkan-master menghitung "nomor berikutnya" hanya dari isi CSV, padahal DB
# bisa punya node yang tidak ada di CSV (ditambahkan lewat tab Master Klasifikasi
# atau oleh impor sheet lain). Nomor yang sama lalu jatuh ke NAMA yang berbeda,
# dan upsert di bawah (ON CONFLICT DO UPDATE nama) diam-diam mengganti nama node
# lama — sementara kode produk yang sudah terbit tetap menunjuk id itu.
for r in psql_baca("SELECT id, nama FROM product_kategori"):
    kat.setdefault(r[0], r[1])
for r in psql_baca("SELECT kategori_id, id, nama FROM product_line"):
    line.setdefault((r[0], r[1]), r[2])
for r in psql_baca("SELECT kategori_id, id, nama FROM product_class"):
    klas.setdefault((r[0], r[1]), r[2])
for r in psql_baca("SELECT kategori_id, class_id, id, nama FROM product_sub_class"):
    sub.setdefault((r[0], r[1], r[2]), r[3])
KAT_BY_NAMA = {low(v): k for k, v in kat.items()}
LINE_BY_NAMA = {(low(v), k[0]): k[1] for k, v in line.items()}
CLASS_BY_NAMA = {(low(v), k[0]): k[1] for k, v in klas.items()}
SUB_BY_NAMA = {(low(v), k[0], k[1]): k[2] for k, v in sub.items()}

kode_lama = {r[0]: r[1] for r in psql_baca("SELECT identitas, kode FROM product_code")}
seq_max = Counter()
for r in psql_baca("SELECT kategori_id, line_id, class_id, sub_class_id, MAX(seq)::text "
                   "FROM product_code GROUP BY 1,2,3,4"):
    seq_max[f"{r[0]}.{r[1]}.{r[2]}.{r[3]}"] = int(r[4])

# ── 3. produk dari sheet-sheet Business / Kroscek ──────────────────────────
KOL = ["Kode 2025", "Nama Accurate 2026", "Nama Barang Principal", "Kemasan", "Satuan",
       "Kategori", "Product Line", "Class", "Sub Class", "Brand", "Penyedia"]

produk, review = [], []
lap = Counter()
gabung_nama, gabung_kode, pindah = [], [], []
sudah_di_run = {}  # identitas → kode, hanya untuk baris yang sudah diproses di jalan ini

for spec in args.produk:
    if "=" not in spec:
        sys.exit(f"--produk harus LABEL=FILE, dapat {spec!r}")
    label, path = spec.split("=", 1)
    label, path = label.strip(), path.strip()
    rows = baca_csv(path)
    hdr_i, ix = kolom_index(rows, ["Nama Accurate 2026", "Kategori", "Product Line", "Class", "Sub Class"])
    c_legacy = ix.get("Kode New Accurate")

    for n, row in enumerate(rows[hdr_i + 1:], start=hdr_i + 2):  # n = nomor baris di sheet
        g = lambda name: clean(row[ix[name]]) if name in ix and ix[name] < len(row) else ""
        nama = g("Nama Accurate 2026")
        if not nama:
            continue
        lap[f"baris:{label}"] += 1
        legacy = clean(row[c_legacy]) if c_legacy is not None and c_legacy < len(row) else ""
        # Nilai error spreadsheet (#N/A, #REF!, #NAME?) bukan kode.
        if legacy.startswith("#"):
            legacy = ""
        d = dict(sumber=label, baris=n, nama=nama, kode_2025=g("Kode 2025"),
                 principal=g("Nama Barang Principal"), kemasan=g("Kemasan"), satuan=g("Satuan"),
                 brand=g("Brand"), penyedia=g("Penyedia"), kode_legacy=legacy,
                 kat_nama=g("Kategori"), line_nama=g("Product Line"),
                 class_nama=g("Class"), sub_nama=g("Sub Class"))

        # ── resolusi hirarkis ──
        kid = KAT_BY_NAMA.get(low(d["kat_nama"]))
        if not kid:
            d["masalah"] = f"Kategori '{d['kat_nama']}' tidak ada di master"
            review.append(d); lap["blocked_kategori"] += 1; continue
        pid = LINE_BY_NAMA.get((low(d["line_nama"]), kid))
        if not pid:
            d["masalah"] = f"Product Line '{d['line_nama']}' tidak terdaftar di kategori {kid} ({kat[kid]})"
            review.append(d); lap["blocked_line"] += 1; continue
        cid = CLASS_BY_NAMA.get((low(d["class_nama"]), kid))
        if not cid and args.daftarkan_master and d["class_nama"]:
            cid = daftar_baru("class", kid, None, d["class_nama"])
        if not cid:
            d["masalah"] = f"Class '{d['class_nama']}' tidak terdaftar di kategori {kid} ({kat[kid]})"
            review.append(d); lap["blocked_class"] += 1; continue
        sid = SUB_BY_NAMA.get((low(d["sub_nama"]), kid, cid))
        if not sid and args.daftarkan_master and d["sub_nama"]:
            sid = daftar_baru("sub_class", kid, cid, d["sub_nama"])
        if not sid:
            d["masalah"] = (f"Sub Class '{d['sub_nama']}' tidak terdaftar di Class {cid} "
                            f"({klas[(kid, cid)]}) kategori {kid} ({kat[kid]})")
            review.append(d); lap["blocked_sub_class"] += 1; continue

        ident = f"K:{d['kode_2025'].upper()}" if d["kode_2025"] else f"N:{nama.upper()}"
        prefix = f"{kid}.{pid}.{cid}.{sid}"

        if ident in sudah_di_run:
            # Baris kedua untuk produk yang sama di jalan ini — tidak terbit kode baru.
            d["kode"] = sudah_di_run[ident]
            (gabung_kode if ident.startswith("K:") else gabung_nama).append((d, ident))
            lap["identitas_sama"] += 1
            continue

        if ident in kode_lama:
            # Sudah punya kode di DB. Kode produk menempel permanen di Accurate, jadi
            # TIDAK diterbitkan ulang walau klasifikasinya berubah — id di kolom
            # kategori/line/class/sub_class tetap diambil dari kode yang sudah ada,
            # supaya kode dan isi barisnya tidak saling bertentangan. Perubahan
            # klasifikasi dilaporkan untuk diputuskan manusia.
            kode = kode_lama[ident]
            k, p, c, s, urut = kode.split(".")
            d.update(kode=kode, ident=ident, ids=(k, p, c, s), seq=int(urut))
            if f"{k}.{p}.{c}.{s}" != prefix:
                lap["klasifikasi_berubah"] += 1
                pindah.append((d, f"{k}.{p}.{c}.{s}", prefix))
            lap["kode_dipertahankan"] += 1
        else:
            seq_max[prefix] += 1
            if seq_max[prefix] > 9999:
                sys.exit(f"nomor urut prefix {prefix} habis (>9999) — kode 4 digit tidak cukup")
            d.update(kode=f"{prefix}.{seq_max[prefix]:04d}", ident=ident, ids=(kid, pid, cid, sid),
                     seq=seq_max[prefix])
            lap["kode_baru"] += 1

        sudah_di_run[ident] = d["kode"]
        produk.append(d)
        if legacy and legacy != d["kode"]:
            lap["kode_beda_dari_sheet"] += 1
        elif legacy:
            lap["kode_sama_dgn_sheet"] += 1

# ── 4. laporan ─────────────────────────────────────────────────────────────
print(f"== Importer klasifikasi produk ({'APPLY' if args.apply else 'DRY-RUN'}) → db={args.db} ==")
print(f"  master taxonomy   : {len(kat)} kategori · {len(line)} product line · "
      f"{len(klas)} class · {len(sub)} sub class")
for spec in args.produk:
    label = spec.split("=", 1)[0].strip()
    print(f"  baris sumber      : {label} = {lap['baris:' + label]}")
print(f"  dapat kode        : {len(produk)}  "
      f"(baru {lap['kode_baru']} · dipertahankan {lap['kode_dipertahankan']})")
print(f"    kode sama dengan generator sheet : {lap['kode_sama_dgn_sheet']}")
print(f"    kode BEDA dari generator sheet   : {lap['kode_beda_dari_sheet']}  "
      f"(resolusi hirarkis + nomor urut global; kode sheet disimpan di kode_legacy)")
if pindah:
    print(f"  ⚠️  klasifikasi berubah, kode DIPERTAHANKAN : {len(pindah)} produk")
    print("       Kode sudah menempel di Accurate, jadi tidak diterbitkan ulang. Kalau memang")
    print("       harus pindah kode, itu keputusan HoD Business + koreksi manual di Accurate.")
    for d, lama, baru in pindah[:5]:
        print(f"       {d['nama'][:50]}: {lama}.* (terpakai) vs {baru}.* (klasifikasi sekarang)")
print(f"  digabung, identitas sama : {lap['identitas_sama']}  "
      f"(kode 2025 sama {len(gabung_kode)} · NAMA sama {len(gabung_nama)})")
if gabung_nama:
    print(f"    ⚠️  {len(gabung_nama)} baris digabung HANYA karena nama sama (tak punya kode 2025).")
    print("       Satu nama bisa dipakai beberapa produk berbeda — perlu diperiksa manusia.")
    for d, ident in gabung_nama[:5]:
        print(f"       {d['sumber']} baris {d['baris']}: {d['nama'][:60]} → {d['kode']}")
if node_baru:
    print(f"  NODE MASTER BARU  : {len(node_baru)}  (--daftarkan-master; id permanen, mohon direview HoD Business)")
    for lvl, kid, cid, nid, nama in node_baru[:15]:
        induk = f"kategori {kid}" if lvl == "class" else f"kategori {kid} class {cid}"
        print(f"       {lvl:9} {nid} · {nama[:40]:42} ({induk})")
    if len(node_baru) > 15:
        print(f"       … {len(node_baru) - 15} lagi")
print(f"  DITAHAN (review)  : {len(review)}  "
      f"(kategori {lap['blocked_kategori']} · line {lap['blocked_line']} · "
      f"class {lap['blocked_class']} · sub class {lap['blocked_sub_class']})")
if review:
    print("    contoh yang butuh keputusan HoD Business:")
    for d in review[:5]:
        print(f"       {d['sumber']} baris {d['baris']}: {d['nama'][:45]} — {d['masalah']}")

if not produk and not review:
    sys.exit("tidak ada baris produk terbaca — cek argumen --produk")

# ── 5. muat ke DB ──────────────────────────────────────────────────────────
tmp = {}


def tulis(nama, header, rows):
    fd, path = tempfile.mkstemp(suffix=".csv", prefix=f"klasifikasi_{nama}_")
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    tmp[nama] = path
    return path


tulis("kat", ["id", "nama"], [[k, v] for k, v in kat.items()])
tulis("line", ["kategori_id", "id", "nama"], [[k[0], k[1], v] for k, v in line.items()])
tulis("class", ["kategori_id", "id", "nama"], [[k[0], k[1], v] for k, v in klas.items()])
tulis("sub", ["kategori_id", "class_id", "id", "nama"], [[k[0], k[1], k[2], v] for k, v in sub.items()])
tulis("code", ["kode", "kategori_id", "line_id", "class_id", "sub_class_id", "seq", "identitas",
               "nama", "nama_principal", "kemasan", "satuan", "brand", "penyedia",
               "kode_2025", "kode_legacy", "sumber"],
      [[d["kode"], *d["ids"], d["seq"], d["ident"], d["nama"], d["principal"], d["kemasan"],
        d["satuan"], d["brand"], d["penyedia"], d["kode_2025"], d["kode_legacy"], d["sumber"]]
       for d in produk])
rev_rows = [[d["sumber"], d["baris"], d["nama"], d["principal"], d["brand"], d["penyedia"],
             d["kemasan"], d["satuan"], d["kode_2025"], d["kode_legacy"], d["kat_nama"],
             d["line_nama"], d["class_nama"], d["sub_nama"], d["masalah"]] for d in review]
if args.review_gabung_nama:
    rev_rows += [[d["sumber"], d["baris"], d["nama"], d["principal"], d["brand"], d["penyedia"],
                  d["kemasan"], d["satuan"], d["kode_2025"], d["kode_legacy"], d["kat_nama"],
                  d["line_nama"], d["class_nama"], d["sub_nama"],
                  f"Digabung ke {d['kode']} karena nama sama (tanpa kode 2025) — pastikan memang produk yang sama"]
                 for d, _ in gabung_nama]
tulis("review", ["sumber", "sumber_baris", "nama", "nama_principal", "brand", "penyedia",
                 "kemasan", "satuan", "kode_2025", "kode_legacy", "kategori_nama", "line_nama",
                 "class_nama", "sub_class_nama", "masalah"], rev_rows)

label_list = ", ".join("'" + s.split("=", 1)[0].strip().replace("'", "''") + "'" for s in args.produk)
nz = lambda c: f"NULLIF(s.{c},'')"

sql = f"""
CREATE TEMP TABLE stg_kat   (id TEXT, nama TEXT);
CREATE TEMP TABLE stg_line  (kategori_id TEXT, id TEXT, nama TEXT);
CREATE TEMP TABLE stg_class (kategori_id TEXT, id TEXT, nama TEXT);
CREATE TEMP TABLE stg_sub   (kategori_id TEXT, class_id TEXT, id TEXT, nama TEXT);
CREATE TEMP TABLE stg_code  (kode TEXT, kategori_id TEXT, line_id TEXT, class_id TEXT,
  sub_class_id TEXT, seq TEXT, identitas TEXT, nama TEXT, nama_principal TEXT, kemasan TEXT,
  satuan TEXT, brand TEXT, penyedia TEXT, kode_2025 TEXT, kode_legacy TEXT, sumber TEXT);
CREATE TEMP TABLE stg_review (sumber TEXT, sumber_baris TEXT, nama TEXT, nama_principal TEXT,
  brand TEXT, penyedia TEXT, kemasan TEXT, satuan TEXT, kode_2025 TEXT, kode_legacy TEXT,
  kategori_nama TEXT, line_nama TEXT, class_nama TEXT, sub_class_nama TEXT, masalah TEXT);

\\copy stg_kat    FROM '{tmp['kat']}'    WITH (FORMAT csv, HEADER true)
\\copy stg_line   FROM '{tmp['line']}'   WITH (FORMAT csv, HEADER true)
\\copy stg_class  FROM '{tmp['class']}'  WITH (FORMAT csv, HEADER true)
\\copy stg_sub    FROM '{tmp['sub']}'    WITH (FORMAT csv, HEADER true)
\\copy stg_code   FROM '{tmp['code']}'   WITH (FORMAT csv, HEADER true)
\\copy stg_review FROM '{tmp['review']}' WITH (FORMAT csv, HEADER true)

INSERT INTO product_kategori (id, nama) SELECT id, nama FROM stg_kat
  ON CONFLICT (id) DO UPDATE SET nama = EXCLUDED.nama;
INSERT INTO product_line (kategori_id, id, nama) SELECT kategori_id, id, nama FROM stg_line
  ON CONFLICT (kategori_id, id) DO UPDATE SET nama = EXCLUDED.nama;
INSERT INTO product_class (kategori_id, id, nama) SELECT kategori_id, id, nama FROM stg_class
  ON CONFLICT (kategori_id, id) DO UPDATE SET nama = EXCLUDED.nama;
INSERT INTO product_sub_class (kategori_id, class_id, id, nama)
  SELECT kategori_id, class_id, id, nama FROM stg_sub
  ON CONFLICT (kategori_id, class_id, id) DO UPDATE SET nama = EXCLUDED.nama;

-- Kode TIDAK diubah untuk produk yang sudah punya (kunci: identitas). Yang
-- diperbarui hanya atribut deskriptif + jejak kode lama.
INSERT INTO product_code (kode, kategori_id, line_id, class_id, sub_class_id, seq, identitas,
  nama, nama_principal, kemasan, satuan, brand, penyedia, kode_2025, kode_legacy, sumber)
SELECT s.kode, s.kategori_id, s.line_id, s.class_id, s.sub_class_id, s.seq::int, s.identitas,
  s.nama, {nz('nama_principal')}, {nz('kemasan')}, {nz('satuan')}, {nz('brand')},
  {nz('penyedia')}, {nz('kode_2025')}, {nz('kode_legacy')}, s.sumber
FROM stg_code s
ON CONFLICT (identitas) DO UPDATE SET
  nama = EXCLUDED.nama, nama_principal = EXCLUDED.nama_principal,
  kemasan = EXCLUDED.kemasan, satuan = EXCLUDED.satuan, brand = EXCLUDED.brand,
  penyedia = EXCLUDED.penyedia, kode_2025 = EXCLUDED.kode_2025,
  kode_legacy = EXCLUDED.kode_legacy, sumber = EXCLUDED.sumber, updated_at = now();

-- Pasangkan ke mirror Accurate lewat kode berjalan (kode_2025). Hanya lewat
-- kode: nama produk tidak unik, pencocokan nama menghasilkan pasangan palsu.
UPDATE product_code p SET accurate_item_id = ai.id, updated_at = now()
  FROM accurate_item ai
 WHERE p.accurate_item_id IS DISTINCT FROM ai.id
   AND p.kode_2025 IS NOT NULL AND ai.no = p.kode_2025;

-- Antrean review disegarkan per sumber: baris yang sekarang sudah bisa
-- di-resolve (master sudah dilengkapi) hilang sendiri dari daftar.
DELETE FROM product_code_review r
 WHERE r.sumber IN ({label_list})
   AND NOT EXISTS (SELECT 1 FROM stg_review s
                    WHERE s.sumber = r.sumber AND s.sumber_baris::int = r.sumber_baris);
INSERT INTO product_code_review (sumber, sumber_baris, nama, nama_principal, brand, penyedia,
  kemasan, satuan, kode_2025, kode_legacy, kategori_nama, line_nama, class_nama,
  sub_class_nama, masalah)
SELECT s.sumber, s.sumber_baris::int, s.nama, {nz('nama_principal')}, {nz('brand')},
  {nz('penyedia')}, {nz('kemasan')}, {nz('satuan')}, {nz('kode_2025')}, {nz('kode_legacy')},
  {nz('kategori_nama')}, {nz('line_nama')}, {nz('class_nama')}, {nz('sub_class_nama')}, s.masalah
FROM stg_review s
ON CONFLICT (sumber, sumber_baris) DO UPDATE SET
  nama = EXCLUDED.nama, kategori_nama = EXCLUDED.kategori_nama,
  line_nama = EXCLUDED.line_nama, class_nama = EXCLUDED.class_nama,
  sub_class_nama = EXCLUDED.sub_class_nama, masalah = EXCLUDED.masalah,
  imported_at = now();

\\echo '--- LAPORAN (dalam txn) ---'
SELECT 'kategori=' || count(*) FROM product_kategori;
SELECT 'product_line=' || count(*) FROM product_line;
SELECT 'class=' || count(*) FROM product_class;
SELECT 'sub_class=' || count(*) FROM product_sub_class;
SELECT 'kode_produk=' || count(*) FROM product_code;
SELECT 'kode_cocok_accurate=' || count(*) FROM product_code WHERE accurate_item_id IS NOT NULL;
SELECT 'review_terbuka=' || count(*) FROM product_code_review WHERE status='terbuka';
SELECT 'sumber: ' || sumber || ' = ' || count(*) FROM product_code GROUP BY sumber ORDER BY 1;
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
