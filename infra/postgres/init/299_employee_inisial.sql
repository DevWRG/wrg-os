-- Inisial 3 huruf karyawan (Data Karyawan /karyawan).
--
-- Sumber: form "Pendataan Inisial Karyawan" — tiap karyawan mengusulkan kode 3 huruf
-- kapital yang mudah dikenali. Disimpan per karyawan, unik, diisi/diubah lewat form
-- /karyawan. Kolom boleh kosong (karyawan yang belum mengisi). Additive + idempoten.

ALTER TABLE employee ADD COLUMN IF NOT EXISTS inisial TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_inisial_format') THEN
    ALTER TABLE employee ADD CONSTRAINT employee_inisial_format CHECK (inisial ~ '^[A-Z]{3}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS employee_inisial_uniq ON employee (inisial) WHERE inisial IS NOT NULL;
