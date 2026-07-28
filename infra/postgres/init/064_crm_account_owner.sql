-- 064 — F122 row-level scope: pemilik akun EKSPLISIT di crm_account.
--
-- Kenapa kolom sendiri, bukan diturunkan dari invoice terakhir: faskes yang
-- BELUM pernah transaksi (prospek) tak punya salesman sama sekali, jadi tak
-- bisa di-scope. owner_am_id bikin kepemilikan bisa ditetapkan sejak prospek
-- dan tidak berubah sendiri tiap ada invoice baru dari AM lain.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE crm_account ADD COLUMN IF NOT EXISTS owner_am_id TEXT;

-- FK lunak: kalau AM dihapus dari master_user, akun jadi tak-bertuan (bukan error).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_owner_fk') THEN
    ALTER TABLE crm_account
      ADD CONSTRAINT crm_account_owner_fk FOREIGN KEY (owner_am_id)
      REFERENCES master_user (am_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_account_owner_idx ON crm_account (owner_am_id);

-- Backfill: pemilik awal = AM invoice TERAKHIR customer itu (sama dengan
-- atribusi yang selama ini ditampilkan di AR/Accounts), supaya setelah rilis
-- tak ada akun yang mendadak tak-bertuan. Hanya mengisi yang masih NULL —
-- penugasan manual tidak pernah ditimpa, jadi aman dijalankan ulang.
WITH last_inv AS (
  SELECT DISTINCT ON (ai.customer_id) ai.customer_id AS cid, mu.am_id
  FROM accurate_invoice ai
  JOIN accurate_salesman acs ON acs.id = ai.salesman_id
  JOIN master_user mu ON mu.am_id = acs.master_user_id::text
  WHERE ai.customer_id IS NOT NULL
  ORDER BY ai.customer_id, ai.tanggal DESC
)
INSERT INTO crm_account (account_id, owner_am_id)
SELECT li.cid, li.am_id
FROM last_inv li JOIN accurate_customer ac ON ac.id = li.cid
ON CONFLICT (account_id) DO UPDATE
  SET owner_am_id = COALESCE(crm_account.owner_am_id, EXCLUDED.owner_am_id),
      updated_at = now();
