#!/usr/bin/env python3
"""F176 Riwayat Alat — impor Google Form "Kegiatan Teknisi" → tabel alat_riwayat_form (migrasi 328).

Sumber: spreadsheet "Kegiatan Teknisi" (milik support@), sheet **"Form Responses 1"** = data mentah form.
Sheet lain (Kunjungan 2024/2025/2026, Service, Install, …) hanya potongan/rekap sheet itu — jangan dipakai.
Ekspor lewat konektor Drive ditolak (berkas terlalu besar), jadi unduh manual:
  - buka sheet "Form Responses 1" → File → Download → CSV  (hanya sheet aktif, kecil), atau
  - File → Download → Microsoft Excel (.xlsx)               (semua sheet; importer memilih sheetnya).

Pakai: python3 import_kegiatan_teknisi.py --file ~/Downloads/Kegiatan\\ Teknisi.xlsx [--db wrg_os_dev] [--apply]
  default = DRY-RUN (BEGIN … ROLLBACK, hanya laporan).

Idempoten: baris_key = md5(timestamp|SN|teknisi|jenis kunjungan). Impor ulang ekspor yang lebih baru hanya
menambah baris baru (ON CONFLICT DO NOTHING). Yang TIDAK diimpor: kolom foto (path internal AppSheet, bukan
tautan), email pengirim, nama analis, dan kolom rumus (Evaluasi = "=AC2").

Data TIDAK di-commit ke repo (nama faskes & teknisi asli).
"""
import argparse, csv, hashlib, io, os, re, subprocess, sys, tempfile
from collections import Counter
from datetime import datetime

KOLOM = {  # nama header form → kolom tabel
    "Timestamp": "waktu",
    "Jenis Kegiatan": "jenis_kegiatan",
    "Kantor Cabang": "cabang",
    "Kota": "kota",
    "Nama Customer": "customer_teks",
    "Jenis Alat": "jenis_alat",
    "Type Alat": "type_alat",
    "Serial Number": "sn_teks",
    "Nama Teknisi": "teknisi_nama",
    "Jenis Kunjungan": "jenis_kunjungan",
    "Keluhan Atau Error": "keluhan",
    "Kegiatan": "kegiatan",
    "Jumlah Tes Sebulan Terakhir": "jumlah_tes",
    "Note": "catatan",
    "Kondisi Alat": "kondisi_alat",
    "Keterangan": "keterangan",
    "Waktu Keluhan Customer": "waktu_keluhan",
    "Waktu Penyelesaian Keluhan": "waktu_selesai",
    "Status SLA": "status_sla",
}
SPAREPART = ("1. Pergantian Sparepart & Catalog", "2. Pergantian Sparepart & Catalog")
KOSONG = {"", "-", "--", "none", "null", "nan", "n/a", "na", "tidak ada", "tdk ada"}
TABEL = ["baris_key", "waktu", "jenis_kegiatan", "jenis_kunjungan", "cabang", "kota", "customer_teks",
         "jenis_alat", "type_alat", "sn_teks", "sn_key", "teknisi_nama", "keluhan", "kegiatan", "jumlah_tes",
         "sparepart", "catatan", "kondisi_alat", "keterangan", "waktu_keluhan", "waktu_selesai", "status_sla"]


def teks(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    if s.startswith("="):  # rumus yang ikut terekspor
        return ""
    return "" if s.lower() in KOSONG else s


def norm_sn(raw):
    """Sama persis dengan alat_sn_key() (328) / normSn() di asetTetapRekon.ts."""
    s = re.sub(r"^['\"`‘’]+", "", str(raw or "").strip())
    if not s:
        return ""
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    s = re.sub(r"\s+", "", s.upper())
    return s.lstrip("0") or s


class Tanggal:
    """Waktu dari xlsx (datetime) atau CSV (teks). Urutan hari/bulan CSV ditebak SEKALI per berkas."""

    def __init__(self, sampel):
        self.hari_dulu = None
        for v in sampel:
            m = re.match(r"\s*(\d{1,2})/(\d{1,2})/\d{4}", str(v or ""))
            if m and int(m.group(1)) > 12:
                self.hari_dulu = True
                break
            if m and int(m.group(2)) > 12:
                self.hari_dulu = False
                break

    def baca(self, v):
        if v is None or v == "":
            return None
        if isinstance(v, datetime):
            return v
        s = str(v).strip()
        for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, f)
            except ValueError:
                pass
        m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", s)
        if not m:
            return None
        a, b, th = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hari, bulan = (a, b) if self.hari_dulu else (b, a)
        try:
            return datetime(th, bulan, hari, int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0))
        except ValueError:
            return None


def baca_berkas(path):
    if path.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(path, read_only=True, data_only=True)
        nama = next((n for n in wb.sheetnames if n.strip().lower() == "form responses 1"), None)
        if not nama:
            sys.exit(f"Sheet 'Form Responses 1' tak ada di {path}. Sheet: {wb.sheetnames}")
        it = wb[nama].iter_rows(values_only=True)
        header = [teks(h) if h is not None else "" for h in next(it)]
        return header, [list(r) for r in it]
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.reader(fh))
    return [h.strip() for h in rows[0]], rows[1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--db", default="wrg_os_dev")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    header, rows = baca_berkas(os.path.expanduser(args.file))
    idx = {h: i for i, h in enumerate(header) if h}
    hilang = [h for h in list(KOLOM) + list(SPAREPART) if h not in idx]
    if "Timestamp" in hilang or "Serial Number" in hilang:
        sys.exit(f"Header wajib tak ditemukan: {hilang}")
    if hilang:
        print(f"⚠️  kolom tak ada (diisi kosong): {hilang}")

    ambil = lambda r, h: r[idx[h]] if h in idx and idx[h] < len(r) else None
    tgl = Tanggal(ambil(r, "Timestamp") for r in rows[:2000])
    keluar, lewati, kunci = [], Counter(), set()
    for r in rows:
        if not r or ambil(r, "Timestamp") in (None, ""):
            continue
        rec = {}
        for h, kol in KOLOM.items():
            v = ambil(r, h)
            if kol in ("waktu", "waktu_keluhan", "waktu_selesai"):
                d = tgl.baca(v)
                rec[kol] = d.strftime("%Y-%m-%d %H:%M:%S") if d else ""
            elif kol == "jumlah_tes":
                s = teks(v).replace(",", ".")
                rec[kol] = s if re.fullmatch(r"\d+(\.\d+)?", s) else ""
            else:
                rec[kol] = teks(v)
        if not rec["waktu"]:
            lewati["timestamp tak terbaca"] += 1
            continue
        rec["sparepart"] = " · ".join(x for x in (teks(ambil(r, h)) for h in SPAREPART) if x)
        rec["sn_key"] = norm_sn(rec["sn_teks"])
        basis = "|".join([rec["waktu"], rec["sn_key"], rec["teknisi_nama"].lower(), rec["jenis_kunjungan"].lower()])
        rec["baris_key"] = hashlib.md5(basis.encode()).hexdigest()
        if rec["baris_key"] in kunci:
            lewati["duplikat dalam berkas"] += 1
            continue
        kunci.add(rec["baris_key"])
        keluar.append(rec)

    print(f"== Berkas: {len(rows)} baris, {len(keluar)} siap, dilewati: {dict(lewati) or '-'}")
    if keluar:
        w = sorted(r["waktu"] for r in keluar)
        print(f"   rentang {w[0]} → {w[-1]}; ber-SN {sum(1 for r in keluar if r['sn_key'])}")
        print(f"   jenis: {Counter(r['jenis_kunjungan'] or '?' for r in keluar).most_common(8)}")

    buf = io.StringIO()
    wr = csv.writer(buf)
    for r in keluar:
        wr.writerow([r[k] for k in TABEL])
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as tmp:
        tmp.write(buf.getvalue())
    kol = ", ".join(TABEL)
    # Waktu form = jam WIB tanpa zona → ditandai +07 eksplisit (zona sesi DB bisa UTC).
    nullif = ", ".join(f"(NULLIF({k}, '') || '+07')::timestamptz" if k.startswith("waktu")
                       else f"NULLIF({k}, '')::numeric" if k == "jumlah_tes" else f"NULLIF({k}, '')"
                       for k in TABEL)
    sql = f"""
\\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE stg ({", ".join(f"{k} text" for k in TABEL)}) ON COMMIT DROP;
\\copy stg FROM '{tmp.name}' WITH (FORMAT csv)
WITH ins AS (
  INSERT INTO alat_riwayat_form ({kol})
  SELECT {nullif} FROM stg
  ON CONFLICT (baris_key) DO NOTHING
  RETURNING sn_key
)
SELECT 'baru', count(*) FROM ins
UNION ALL SELECT 'baru cocok alat KSO', count(*) FROM ins WHERE sn_key IN (SELECT sn_key FROM kso_asset)
UNION ALL SELECT 'baru cocok alat beli', count(*) FROM ins
  WHERE sn_key IN (SELECT alat_sn_key(serial_number) FROM installation_unit);
SELECT 'total di tabel', count(*) FROM alat_riwayat_form;
{"COMMIT" if args.apply else "ROLLBACK"};
"""
    res = subprocess.run(["psql", args.db, "-tA", "-F", ": "], input=sql, capture_output=True, text=True)
    os.unlink(tmp.name)
    if res.returncode != 0:
        sys.exit(res.stderr)
    print(f"== DB {args.db} ({'COMMIT' if args.apply else 'DRY-RUN, ROLLBACK'})")
    for ln in res.stdout.split("\n"):
        if ": " in ln:
            print("  ", ln)


if __name__ == "__main__":
    main()
