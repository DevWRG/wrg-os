-- F154: interval PM per MODEL alat (kso_asset.nama_alat, mis. "Clover A1c", "Zybio Z52"), bukan per kategori
-- (kso_asset.type_alat, mis. "POCT Clover") — koreksi user 18 Nov 2026 atas 334. Kunci jadwal_pm_interval kini
-- upper(btrim(COALESCE(NULLIF(nama_alat, ''), type_alat))). Isian berkunci kategori (dibuat sebelum koreksi ini)
-- tak lagi cocok dengan alat mana pun → dibuang supaya tak tersisa diam-diam.

DELETE FROM jadwal_pm_interval pi
WHERE NOT EXISTS (
  SELECT 1 FROM kso_asset a
  WHERE upper(btrim(COALESCE(NULLIF(a.nama_alat, ''), a.type_alat))) = pi.type_alat
);

COMMENT ON TABLE jadwal_pm_interval IS
  'F154: interval PM per MODEL alat KSO (kolom type_alat berisi kunci upper(btrim(COALESCE(nama_alat, type_alat)))).';
