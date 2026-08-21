-- 080 — F76 WatchPoint: target per metric HoD bisa diubah dari UI.
--
-- Sebelumnya target 100% hardcoded di apps/api/src/repo/watchpoint.ts (angka
-- brief Direktur Juni 2026, HOD-Prompt-Workflow.md §3) sehingga tiap revisi
-- kesepakatan Direktur–HoD butuh deploy. Kolom di bawah = LAPIS OVERRIDE:
-- angka di kode tetap jadi default, baris di sini hanya menimpanya.
--
-- target_mode:
--   'default'   → pakai target dari kode (baris ini tidak menimpa apa pun)
--   'value'     → pakai target_override (angka)
--   'milestone' → target = NULL, metric jadi kualitatif (status diisi manual
--                 lewat status_override, mis. Live/WIP/Off)
-- Sengaja 3 nilai, bukan sekadar "target_override NULL = default": tanpa itu
-- tidak ada cara membedakan "belum pernah diatur" dari "sengaja dijadikan
-- milestone tanpa angka".

ALTER TABLE watchpoint_metric
  ADD COLUMN IF NOT EXISTS target_override numeric,
  ADD COLUMN IF NOT EXISTS target_mode     text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS updated_by      text;

ALTER TABLE watchpoint_metric DROP CONSTRAINT IF EXISTS watchpoint_metric_target_mode_chk;
ALTER TABLE watchpoint_metric ADD CONSTRAINT watchpoint_metric_target_mode_chk
  CHECK (target_mode IN ('default', 'value', 'milestone'));

COMMENT ON COLUMN watchpoint_metric.target_override IS 'Target pengganti (dipakai hanya bila target_mode = ''value'').';
COMMENT ON COLUMN watchpoint_metric.target_mode IS 'default = target dari kode · value = target_override · milestone = tanpa angka.';
COMMENT ON COLUMN watchpoint_metric.updated_by IS 'Email/identitas pengubah terakhir (jejak audit ringan).';
