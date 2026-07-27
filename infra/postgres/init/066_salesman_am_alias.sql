-- 066 — Petakan kode salesman Accurate yang belum nyambung ke master_user.
--
-- Kasus: di menu per-AM muncul baris "YGO" (cabang kosong → region OFFICE)
-- TERPISAH dari "Muhammad Prayugo", padahal YGO itu kode Accurate untuk Yugo
-- (panggilan Muhammad Prayugo, cabang Palembang). Selama master_user_id-nya
-- NULL, semua query per-AM tak bisa mengatribusikan faktur itu ke siapa pun.
--
-- Sync Accurate hanya menimpa name/number/branch/suspended — master_user_id
-- TIDAK ikut ditimpa (lihat accurateSync.ts), jadi pemetaan ini permanen.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- Fallback resolusi di query (joinAmFromSalesman) mencocokkan
-- accurate_invoice.salesman_name ke accurate_salesman.name → butuh index ini.
CREATE INDEX IF NOT EXISTS accurate_salesman_name_idx ON accurate_salesman (name);

-- YGO → Yugo (Muhammad Prayugo). Hanya mengisi yang masih NULL, jadi pemetaan
-- manual yang sudah ada tidak pernah ditimpa dan aman dijalankan ulang.
UPDATE accurate_salesman acs
   SET master_user_id = mu.am_id::bigint
  FROM master_user mu
 WHERE acs.master_user_id IS NULL
   AND upper(btrim(acs.name)) = 'YGO'
   AND upper(btrim(mu.panggilan)) = 'YUGO'
   AND mu.am_id ~ '^[0-9]+$';
