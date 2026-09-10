-- 085 — Stiker Aset & Asset Tagging Audit (F53, OPS). Registry aset yang
-- ditag QR-code (bukan katalog aset lengkap spt F132 — F132 masih blocked,
-- nunggu lokasi source sistem legacy "gais"). F53 self-contained: aset di
-- sini cuma yang perlu label fisik (QR + cetak), bukan katalog inventaris
-- menyeluruh.
--
-- Skema kolom mengikuti pola nyata yang sudah dipakai tim GA di Excel (lihat
-- tool sebelumnya github.com/DevWRG/label-asset — contoh kode
-- WRG-KMG-FRN-001 dst): kode/nama/jenis kepemilikan (Aset vs Inventaris)/
-- kategori/lokasi cabang/letak. `kode` diisi manual (bukan auto-generate) —
-- skema penomoran <lokasi>-<kategori>-<urut> belum ada aturan resminya,
-- menebak akan salah lebih sering daripada membantu.
--
-- `asset_tag_audit_log` = riwayat verifikasi fisik berkala (scan/cek label
-- masih ada & barangnya masih di situ) — bagian "Audit" di nama fitur.
-- F34 (aset penghasil revenue + rekonsiliasi Accurate, domain FINANCE)
-- DIKONFIRMASI terpisah dari F53 (bukan dependency) — lihat konsultasi
-- Direktur, F53 tetap ranah GA/OPS murni.

CREATE TABLE IF NOT EXISTS asset_tag (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  kode              text NOT NULL UNIQUE,
  nama              text NOT NULL,
  jenis_kepemilikan text NOT NULL DEFAULT 'aset' CHECK (jenis_kepemilikan IN ('aset', 'inventaris')),
  kategori          text,
  lokasi_cabang     text,
  letak             text,
  foto_path         text,

  active            boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_tag_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag_id  uuid NOT NULL REFERENCES asset_tag(id),

  audited_by    text NOT NULL,
  audited_at    timestamptz NOT NULL DEFAULT now(),
  found         boolean NOT NULL,
  note          text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_tag_active_idx        ON asset_tag (active);
CREATE INDEX IF NOT EXISTS asset_tag_audit_log_tag_idx ON asset_tag_audit_log (asset_tag_id, audited_at DESC);

COMMENT ON TABLE asset_tag IS
  'F53 — registry aset yang ditag QR-code (bukan katalog aset lengkap). kode manual, cocok skema Excel GA existing (WRG-<lokasi>-<kategori>-<urut>).';
COMMENT ON TABLE asset_tag_audit_log IS
  'F53 — riwayat verifikasi fisik (scan label + cek barang masih ada). found=false = dilaporkan hilang/tak ketemu saat audit.';
