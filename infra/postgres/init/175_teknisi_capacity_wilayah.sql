-- F8/F26 konsolidasi roster teknisi (keputusan Direktur 2026-09-07, membalik
-- desain awal "self-contained per fitur" — lihat brief link-data-existing
-- batch2). Sebelumnya F26 punya roster sendiri (`teknisi_roster`, kolom
-- `area text[]`) yang READ-ONLY dari app (cuma diisi lewat seed/SQL manual) —
-- auto-assign-by-area sudah jalan tapi tak ada UI kelola. F8 `teknisi_capacity`
-- (readiness board) PUNYA UI CRUD tapi tak ada konsep wilayah.
--
-- Sekarang: teknisi_capacity jadi SATU sumber, dengan `wilayah` (nama sama
-- dgn niat `area` lama, ganti nama supaya jelas ini scope baru bukan sekadar
-- alias). service_ticket.assigned_teknisi_id dialihkan ke teknisi_capacity.
--
-- teknisi_roster TIDAK di-DROP (dibiarkan, superseded) — histori/rollback
-- lebih penting daripada kerapian skema, dan tak ada biaya menyimpannya.

BEGIN;

ALTER TABLE teknisi_capacity ADD COLUMN IF NOT EXISTS wilayah text[] NOT NULL DEFAULT '{}';

-- Bawa masuk teknisi_roster yang namanya BELUM ada di teknisi_capacity —
-- nama satu-satunya identitas yang ada di kedua tabel (keduanya free-text,
-- tak pernah tertaut master_user/app_user).
INSERT INTO teknisi_capacity (nama, wa_number, wilayah)
SELECT tr.nama, tr.wa_number, tr.area
FROM teknisi_roster tr
WHERE NOT EXISTS (
  SELECT 1 FROM teknisi_capacity tc WHERE lower(btrim(tc.nama)) = lower(btrim(tr.nama))
);

-- Nama yang SUDAH ada di kedua tabel (teknisi F8 yang juga masuk F26) —
-- gabungkan wilayah (union tanpa duplikat), isi wa_number kalau F8-nya kosong.
UPDATE teknisi_capacity tc
SET wilayah = (SELECT array_agg(DISTINCT w ORDER BY w) FROM unnest(tc.wilayah || tr.area) w),
    wa_number = COALESCE(NULLIF(btrim(tc.wa_number), ''), tr.wa_number)
FROM teknisi_roster tr
WHERE lower(btrim(tc.nama)) = lower(btrim(tr.nama));

-- Constraint lama (masih nunjuk teknisi_roster) WAJIB dilepas DULU — remap
-- di bawah menulis id teknisi_capacity ke kolom yang saat itu masih dijaga
-- FK ke teknisi_roster, bakal ditolak kalau urutannya dibalik.
ALTER TABLE service_ticket DROP CONSTRAINT IF EXISTS service_ticket_assigned_teknisi_id_fkey;

-- Remap assigned_teknisi_id histori (teknisi_roster.id -> teknisi_capacity.id
-- via nama) — tanpa ini, tiket lama yang sudah ke-assign jadi yatim begitu
-- constraint baru dipasang.
UPDATE service_ticket st
SET assigned_teknisi_id = tc.id
FROM teknisi_roster tr
JOIN teknisi_capacity tc ON lower(btrim(tc.nama)) = lower(btrim(tr.nama))
WHERE st.assigned_teknisi_id = tr.id;

ALTER TABLE service_ticket ADD CONSTRAINT service_ticket_assigned_teknisi_id_fkey
  FOREIGN KEY (assigned_teknisi_id) REFERENCES teknisi_capacity(id);

COMMENT ON TABLE teknisi_roster IS 'F26 — SUPERSEDED 2026-09-07: konsolidasi ke teknisi_capacity (F8) + kolom wilayah. Dibiarkan (bukan DROP) utk histori/rollback, TIDAK dipakai app lagi (lihat repo/serviceticket.ts).';

COMMIT;
