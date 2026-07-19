-- 061: Backfill employee.am_id (bridge spine ↔ roster) untuk Karyawan 360.
-- Set am_id HANYA bila nama ter-normalisasi cocok UNIK di kedua sisi (employee &
-- master_user) → hindari salah-tautan pada nama ambigu. Idempotent & non-destruktif:
-- hanya mengisi employee.am_id yang masih NULL; yang sudah ter-set tidak diubah.
-- Editor People (Fase B) akan bisa override manual.
-- Catatan: tanpa BEGIN/COMMIT (runner auto-deploy yang membungkus transaksi).

WITH norm_emp AS (
  SELECT id, lower(regexp_replace(btrim(nama), '\s+', ' ', 'g')) AS n
  FROM employee WHERE am_id IS NULL AND nama IS NOT NULL
),
norm_mu AS (
  SELECT am_id, lower(regexp_replace(btrim(nama), '\s+', ' ', 'g')) AS n
  FROM master_user WHERE nama IS NOT NULL
),
mu_uniq AS (
  SELECT n, max(am_id) AS am_id FROM norm_mu GROUP BY n HAVING count(*) = 1
),
emp_uniq AS (
  SELECT n, max(id) AS id FROM norm_emp GROUP BY n HAVING count(*) = 1
)
UPDATE employee e
SET am_id = mu.am_id
FROM emp_uniq eu
JOIN mu_uniq mu ON mu.n = eu.n
WHERE e.id = eu.id;
