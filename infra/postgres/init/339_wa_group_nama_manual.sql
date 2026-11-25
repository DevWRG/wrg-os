-- 339 — Nama grup WA yang diisi MANUAL dari UI (galeri Pola Komunikasi).
--
-- Nama grup hanya diketahui dari subject di state openclaw, dan openclaw cuma
-- mencatatnya untuk grup yang pernah dibuka sesi agennya. Grup yang bot-nya ikut
-- tapi tak pernah memicu agen (wajib mention, dan belum ada yang mention) tak
-- punya subject di mana pun — kartunya tampil sebagai JID angka (24 Nov 2026:
-- 4 grup). Admin mengisi namanya sendiri lewat UI.
--
-- Tabel terpisah dari monitor_pola: job pola-komunikasi meng-upsert
-- monitor_pola.group_name tiap malam dan akan menimpa nama manual.
-- Urutan nama tampil: subject openclaw → nama manual ini → monitor_pola → JID.
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner yang mengatur transaksi.

CREATE TABLE IF NOT EXISTS wa_group_name (
  group_jid  varchar(120) PRIMARY KEY,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);
