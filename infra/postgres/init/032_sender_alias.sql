-- Override resolusi pengirim untuk shared-HP / pushname generik.
-- Kasus: grup HP-bersama (sender_jid = group_jid, tak ada nomor individual) +
-- pushname generik (mis. "d") → resolver 5-tier mentok unknown-sender. Mapping
-- manual (group_jid, pushname) → am_id menutup ini permanen. Dikonsultasi di
-- resolveSender SETELAH body-name eksplisit (Tier A) tapi SEBELUM phone/pushname,
-- jadi #plan <nama> eksplisit tetap menang.
CREATE TABLE IF NOT EXISTS sender_alias (
  id         serial PRIMARY KEY,
  group_jid  varchar(100) NOT NULL,
  pushname   varchar(200) NOT NULL,
  am_id      varchar(50)  NOT NULL,
  note       text,
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- Satu pushname per grup → satu am_id (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS sender_alias_grp_push_uniq
  ON sender_alias (group_jid, lower(pushname));

COMMENT ON TABLE sender_alias IS
  'Override resolusi pengirim shared-HP: (group_jid, pushname) -> am_id. Dipakai resolveSender setelah body-name, sebelum phone/pushname.';
