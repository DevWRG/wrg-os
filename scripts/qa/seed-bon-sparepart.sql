-- Seed F155 Bon Sparepart (dev/QA SAJA — data sintetis, tak pernah dijalankan di prod).
--
-- Mengisi menu /bon-sparepart dengan satu bon untuk tiap kondisi yang perlu dilihat:
--   BN belum dilaporkan · sebagian dilaporkan · dilaporkan dengan 2 SJ kandidat (pilih manual) ·
--   #BON tanpa bon gudang · selesai otomatis · selesai manual · batal.
-- Item & SJ memakai data sintetis mirror dev (SIN.* / SJ-SIN-*). Idempoten: menghapus baris
-- bertanda "[SEED F155]" lalu mengisi ulang. Prasyarat: migrasi 253 + minimal 2 baris teknisi_capacity aktif.
--
--   docker exec -i wrg-postgres psql -U wrg -d wrg_os_dev -f - < scripts/qa/seed-bon-sparepart.sql
--
-- Bersihkan: DELETE FROM bon_sparepart WHERE catatan LIKE '[SEED F155]%';

DELETE FROM bon_sparepart WHERE catatan LIKE '[SEED F155]%';

DO $$
DECLARE
  tek1 uuid; nama1 text; tek2 uuid; nama2 text;
  sj_a bigint; no_a text; sj_b bigint; no_b text;
  spek jsonb;
  s jsonb; bid bigint; it jsonb; urut int;
BEGIN
  SELECT id, nama INTO tek1, nama1 FROM teknisi_capacity WHERE aktif ORDER BY nama LIMIT 1;
  SELECT id, nama INTO tek2, nama2 FROM teknisi_capacity WHERE aktif AND id <> tek1 ORDER BY nama LIMIT 1;
  IF tek1 IS NULL THEN RAISE EXCEPTION 'tak ada teknisi_capacity aktif'; END IF;
  IF tek2 IS NULL THEN tek2 := tek1; nama2 := nama1; END IF;

  -- dua SJ terbaru di mirror, dipakai bon "selesai"
  SELECT id, number INTO sj_a, no_a FROM accurate_delivery_order ORDER BY trans_date DESC, id DESC LIMIT 1;
  SELECT id, number INTO sj_b, no_b FROM accurate_delivery_order WHERE id <> sj_a ORDER BY trans_date DESC, id DESC LIMIT 1;

  spek := jsonb_build_array(
    -- 1. belum dilaporkan, 5 hari lalu
    jsonb_build_object('t', 1, 'asal', 'gudang', 'status', 'dibuat', 'umur', 5, 'cust', 'RSUD Fixture Kediri',
      'catatan', '[SEED F155] belum dilaporkan teknisi', 'item', jsonb_build_array(jsonb_build_array('SIN.00310', 2, 0), jsonb_build_array('SIN.00311', 1, 0))),
    -- 2. sebagian dilaporkan (1 dari 3)
    jsonb_build_object('t', 2, 'asal', 'gudang', 'status', 'dibuat', 'umur', 2, 'cust', null,
      'catatan', '[SEED F155] sebagian dilaporkan', 'item', jsonb_build_array(jsonb_build_array('SIN.00320', 3, 1))),
    -- 3. dilaporkan; SIN.00302 ada di >1 SJ jendela 27 Agu–10 Sep → tak ditautkan otomatis, pilih manual
    jsonb_build_object('t', 1, 'asal', 'gudang', 'status', 'dilaporkan', 'umur', 9, 'cust', null, 'lapor', '2026-08-27T03:00:00Z',
      'catatan', '[SEED F155] dilaporkan, SJ kandidat lebih dari satu', 'item', jsonb_build_array(jsonb_build_array('SIN.00302', 1, 1))),
    -- 4. #BON tanpa bon gudang
    jsonb_build_object('t', 2, 'asal', 'teknisi', 'status', 'dilaporkan', 'umur', 1, 'cust', null, 'lapor', 'sekarang',
      'catatan', '[SEED F155] #BON tanpa bon gudang', 'item', jsonb_build_array(jsonb_build_array('SIN.00340', 1, 1))),
    -- 5. selesai otomatis
    jsonb_build_object('t', 1, 'asal', 'gudang', 'status', 'selesai', 'umur', 14, 'cust', null, 'lapor', 'sekarang', 'sj', 'a', 'sumber', 'otomatis',
      'catatan', '[SEED F155] selesai (SJ tertaut otomatis)', 'item', jsonb_build_array(jsonb_build_array('SIN.00350', 2, 2))),
    -- 6. selesai manual
    jsonb_build_object('t', 2, 'asal', 'gudang', 'status', 'selesai', 'umur', 20, 'cust', null, 'lapor', 'sekarang', 'sj', 'b', 'sumber', 'manual',
      'catatan', '[SEED F155] selesai (SJ ditautkan manual)', 'item', jsonb_build_array(jsonb_build_array('SIN.00360', 1, 1))),
    -- 7. batal
    jsonb_build_object('t', 1, 'asal', 'gudang', 'status', 'batal', 'umur', 7, 'cust', null,
      'catatan', '[SEED F155] batal (salah catat)', 'item', jsonb_build_array(jsonb_build_array('SIN.00370', 1, 0)))
  );

  FOR s IN SELECT * FROM jsonb_array_elements(spek) LOOP
    INSERT INTO bon_sparepart (teknisi_id, teknisi_nama, asal, status, customer_nama, catatan, dibuat_oleh, dibuat_at, dilaporkan_at,
                               sj_id, sj_number, sj_sumber, sj_at, sj_oleh, batal_alasan, batal_oleh)
    VALUES (
      CASE WHEN (s->>'t')::int = 1 THEN tek1 ELSE tek2 END,
      CASE WHEN (s->>'t')::int = 1 THEN nama1 ELSE nama2 END,
      s->>'asal', s->>'status', s->>'cust', s->>'catatan',
      CASE WHEN s->>'asal' = 'teknisi' THEN CASE WHEN (s->>'t')::int = 1 THEN nama1 ELSE nama2 END ELSE 'Seed Gudang' END,
      now() - ((s->>'umur')::int || ' days')::interval,
      CASE WHEN s->>'lapor' IS NULL THEN NULL WHEN s->>'lapor' = 'sekarang' THEN now() - interval '1 day' ELSE (s->>'lapor')::timestamptz END,
      CASE s->>'sj' WHEN 'a' THEN sj_a WHEN 'b' THEN sj_b END,
      CASE s->>'sj' WHEN 'a' THEN no_a WHEN 'b' THEN no_b END,
      s->>'sumber',
      CASE WHEN s->>'sj' IS NOT NULL THEN now() END,
      CASE s->>'sumber' WHEN 'otomatis' THEN 'otomatis' WHEN 'manual' THEN 'Seed Gudang' END,
      CASE WHEN s->>'status' = 'batal' THEN 'salah catat (seed)' END,
      CASE WHEN s->>'status' = 'batal' THEN 'Seed Gudang' END
    ) RETURNING id INTO bid;
    urut := 0;
    FOR it IN SELECT * FROM jsonb_array_elements(s->'item') LOOP
      urut := urut + 1;
      INSERT INTO bon_sparepart_item (bon_id, urut, item_id, item_no, item_nama, qty, satuan, dilaporkan_qty)
      SELECT bid, urut, ai.id, ai.no, COALESCE(ai.name, ai.no), (it->>1)::numeric, ai.unit, (it->>2)::numeric
      FROM accurate_item ai WHERE ai.no = it->>0;
    END LOOP;
  END LOOP;
END $$;

SELECT status, asal, count(*) FROM bon_sparepart WHERE catatan LIKE '[SEED F155]%' GROUP BY 1, 2 ORDER BY 1, 2;
