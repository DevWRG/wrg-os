-- 024_sales_todo_submitted_at.sql — kolom submitted_at untuk sales_todo.
-- Dipakai late-threshold per-role (port legacy): is_late dihitung dari WAKTU
-- KIRIM pesan (bukan waktu proses); ON CONFLICT preserve earliest via LEAST().
ALTER TABLE sales_todo ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
