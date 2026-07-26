-- 063 — F1 SPT: harga per test/unit di form deal. estimate_amount = qty_num × unit_price
-- (dihitung server-side saat create/edit). qty_num sudah ada (057). Additive, idempoten.
ALTER TABLE deal ADD COLUMN IF NOT EXISTS unit_price NUMERIC;
