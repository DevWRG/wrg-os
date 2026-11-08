-- 234 — F33 Kas Station Reconcile Harian Cabang.
--
-- Station = kas cabang (satu cabang = satu station, kunci = teks `cabang`
-- ter-normalisasi huruf besar, sama seperti hod_territory/master_user).
-- Alur: catat kas harian → sistem merekap per minggu (Senin–Minggu) → station
-- mengajukan rekap → pusat approve/reject → bila approve, dana direalisasikan.
--
-- saldo_akhir TIDAK disimpan: dihitung dari saldo_awal + Σmasuk − Σkeluar
-- (pola computed F51/F138). saldo_awal hanya diisi manual pada hari pertama
-- sebuah station; hari berikutnya diset sistem = saldo akhir hari sebelumnya.
-- saldo_fisik (opsional) dibandingkan dengan saldo hitungan sistem → selisih.
-- Tidak ada toleransi selisih & tidak ada tenggat di tingkat DB.
--
-- kas_station_rekap menyimpan SNAPSHOT roll-up saat diajukan, jadi angka yang
-- dilihat pusat tidak ikut bergeser. Status: draft → submitted → approved |
-- rejected (rejected bisa diperbaiki & diajukan lagi). Realisasi dana dicatat
-- di baris rekap yang sudah approved (realisasi_nominal diisi manual — rumus
-- nominal pengajuan/realisasi belum ditetapkan bisnis).
--
-- Additive + idempoten (aman dijalankan ulang).

CREATE TABLE IF NOT EXISTS kas_station_harian (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabang       text NOT NULL CHECK (cabang = upper(btrim(cabang)) AND cabang <> ''),
  tanggal      date NOT NULL,
  saldo_awal   numeric(16,2) NOT NULL CHECK (saldo_awal >= 0),
  saldo_fisik  numeric(16,2) CHECK (saldo_fisik IS NULL OR saldo_fisik >= 0),
  keterangan   text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabang, tanggal)
);

CREATE TABLE IF NOT EXISTS kas_station_transaksi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  harian_id   uuid NOT NULL REFERENCES kas_station_harian(id) ON DELETE CASCADE,
  jenis       text NOT NULL CHECK (jenis IN ('masuk','keluar')),
  nominal     numeric(16,2) NOT NULL CHECK (nominal > 0),
  uraian      text NOT NULL CHECK (btrim(uraian) <> ''),
  bukti_ref   text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kas_station_transaksi_harian_idx ON kas_station_transaksi (harian_id);

CREATE TABLE IF NOT EXISTS kas_station_rekap (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabang              text NOT NULL CHECK (cabang = upper(btrim(cabang)) AND cabang <> ''),
  periode_awal        date NOT NULL,
  periode_akhir       date NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  jumlah_hari         integer NOT NULL CHECK (jumlah_hari > 0),
  saldo_awal          numeric(16,2) NOT NULL,
  total_masuk         numeric(16,2) NOT NULL,
  total_keluar        numeric(16,2) NOT NULL,
  saldo_akhir         numeric(16,2) NOT NULL,
  total_selisih       numeric(16,2) NOT NULL DEFAULT 0,
  jumlah_hari_selisih integer NOT NULL DEFAULT 0,
  submit_count        integer NOT NULL DEFAULT 0,
  submitted_by        text,
  submitted_at        timestamptz,
  decided_by          text,
  decided_at          timestamptz,
  decision_note       text,
  realisasi_nominal   numeric(16,2) CHECK (realisasi_nominal IS NULL OR realisasi_nominal > 0),
  realisasi_by        text,
  realisasi_at        timestamptz,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabang, periode_awal),
  CHECK (periode_akhir = periode_awal + 6),
  CHECK (realisasi_at IS NULL OR status = 'approved')
);

CREATE INDEX IF NOT EXISTS kas_station_rekap_status_idx ON kas_station_rekap (status, periode_awal DESC);

COMMENT ON TABLE kas_station_harian IS
  'F33 — kas harian per station (=cabang). saldo_akhir dihitung, bukan disimpan. saldo_awal hanya manual di hari pertama station.';
COMMENT ON TABLE kas_station_transaksi IS
  'F33 — baris kas masuk/keluar per hari; bukti_ref = referensi teks (nomor nota/tautan), bukan unggahan berkas.';
COMMENT ON TABLE kas_station_rekap IS
  'F33 — snapshot roll-up mingguan (Senin–Minggu) + status approval pusat + realisasi dana.';
