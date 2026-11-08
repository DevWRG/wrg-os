-- 298: F10 Finance Ops Resilience bagian 3 — register cek/giro keluar (ambil alih F29), docs/features/F10-finance-ops-resilience.md.
--
-- Briefing 24 Mei 2026: kasus cek kosong sampai panggilan Polrestabes. Belum ada catatan cek yang diterbitkan WRG
-- di sistem mana pun. Register ini: kasir input → ajukan → HoD Finance setuju/tolak (pembuat tak boleh menyetujui
-- ceknya sendiri) → diserahkan → cair / tolak bank. Saldo pembanding = saldo_akhir rekening koran terakhir (F-CASHIN
-- bank_statement), bukan input manual. Cair dicocokkan otomatis dari mutasi debit rekening koran (nominal sama +
-- nomor seri muncul di deskripsi). Additive + idempoten.

CREATE TABLE IF NOT EXISTS cek_keluar (
  id               BIGSERIAL PRIMARY KEY,
  bank_account_id  UUID NOT NULL REFERENCES bank_account(id) ON DELETE RESTRICT,
  no_seri          TEXT NOT NULL,
  jenis            TEXT NOT NULL DEFAULT 'cek' CHECK (jenis IN ('cek', 'giro')),
  tanggal_terbit   DATE NOT NULL,
  jatuh_tempo      DATE NOT NULL,                 -- cek = tanggal terbit; giro = tanggal efektif
  penerima         TEXT NOT NULL,
  nominal          NUMERIC(18,2) NOT NULL CHECK (nominal > 0),
  keperluan        TEXT NOT NULL,
  dokumen_dasar    TEXT,                          -- no. faktur pembelian / PO (opsional)
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'diajukan', 'disetujui', 'ditolak', 'diserahkan', 'cair', 'tolak_bank', 'batal')),
  dibuat_oleh      TEXT NOT NULL,
  dibuat_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  diputus_oleh     TEXT,                          -- penyetuju / penolak
  diputus_at       TIMESTAMPTZ,
  cair_line_id     UUID REFERENCES bank_statement_line(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cek_keluar_seri_unik ON cek_keluar (bank_account_id, upper(no_seri));
CREATE INDEX IF NOT EXISTS cek_keluar_status_idx ON cek_keluar (status, jatuh_tempo);

-- Riwayat status append-only (aplikasi hanya boleh INSERT/SELECT). Cek tak pernah dihapus — hanya `batal` + alasan.
CREATE TABLE IF NOT EXISTS cek_keluar_log (
  id        BIGSERIAL PRIMARY KEY,
  cek_id    BIGINT NOT NULL REFERENCES cek_keluar(id) ON DELETE RESTRICT,
  dari      TEXT,
  ke        TEXT NOT NULL,
  oleh      TEXT NOT NULL,
  catatan   TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cek_keluar_log_cek_idx ON cek_keluar_log (cek_id, at);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON cek_keluar TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE cek_keluar_id_seq TO wrg_app;
    GRANT SELECT, INSERT ON cek_keluar_log TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE cek_keluar_log_id_seq TO wrg_app;
  END IF;
END $$;
