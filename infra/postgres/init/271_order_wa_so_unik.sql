-- 271 — F90 #ORDER: satu SO Accurate hanya untuk satu pesanan.
--
-- cocokkanSo() dulu bisa menandai DUA pesanan (faskes sama, barang sama) dengan SO yang sama
-- dalam satu putaran — pesanan kedua hilang dari antrean padahal SO-nya belum diinput Admin
-- Sales (ketemu di uji fungsional 3 Nov 2026). Kode sudah diperbaiki; index ini pagar terakhir.
--
-- Pesanan yang terlanjur berbagi SO: yang dikonfirmasi paling awal mempertahankannya, sisanya
-- dikembalikan ke antrean (so_id/so_number/selesai_* dikosongkan) supaya dicocokkan ulang.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

WITH dobel AS (
  SELECT id, row_number() OVER (PARTITION BY so_id ORDER BY dikonfirmasi_at NULLS LAST, id) AS rn
  FROM order_wa WHERE so_id IS NOT NULL AND status <> 'batal'
)
UPDATE order_wa o
SET status = 'antrean', so_id = NULL, so_number = NULL, selesai_at = NULL, selesai_oleh = NULL,
    catatan = concat_ws(' · ', o.catatan, 'dikembalikan ke antrean oleh migrasi 271 (SO dipakai pesanan lain)'),
    updated_at = now()
FROM dobel d
WHERE d.id = o.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS order_wa_so_unik ON order_wa (so_id)
  WHERE so_id IS NOT NULL AND status <> 'batal';
