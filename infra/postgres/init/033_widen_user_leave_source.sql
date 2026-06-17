-- user_leave.source semula varchar(10) → tak muat nilai 'detect_leave' (12 char)
-- yang dipakai jalur approve detect-leave (dashboard & WA) → INSERT selalu gagal
-- (22001 value too long) → nol row detect_leave pernah masuk. Lebarkan ke 20.
ALTER TABLE user_leave ALTER COLUMN source TYPE varchar(20);
