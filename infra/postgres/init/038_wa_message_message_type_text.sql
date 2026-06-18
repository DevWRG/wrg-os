-- wa_message.message_type semula varchar(20) → tak muat MIME panjang dari openclaw
-- (mis. 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
-- utk .docx/.xlsx) → ingestOpenclawMessages INSERT gagal (22001 value too long) →
-- pesan media dgn MIME panjang DROP total (tak ke-capture). Jadikan text (tanpa batas).
ALTER TABLE wa_message ALTER COLUMN message_type TYPE text;
