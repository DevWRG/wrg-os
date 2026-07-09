-- 054 — Buang orphan RBAC feature 'employee-spine'. Migrasi 052 daftarin feature
-- key 'employee-spine' (path /employee-spine), tapi menu-nya sudah digabung ke
-- "People Analytics" (/people, feature key 'people'). Baris feature lama jadi
-- yatim (route /employee-spine sudah dihapus) → dibersihkan. Additive, idempoten.
-- CATATAN: seed/DDL WRG-OS TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.

DELETE FROM access_permission WHERE feature_key = 'employee-spine';
DELETE FROM feature WHERE key = 'employee-spine';
