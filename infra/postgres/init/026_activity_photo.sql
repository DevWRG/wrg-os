-- 026_activity_photo.sql — foto + geotag tertempel ke activity_log (foto-followup).
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS photo_path   TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS photo_geotag JSONB;
