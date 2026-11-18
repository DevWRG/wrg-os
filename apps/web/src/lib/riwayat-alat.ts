// Utilitas murni menu Riwayat Alat (F176).

/** Item sparepart dari teks isian: dipisah " · " (dua kolom Google Form lama digabung impor), baris baru, atau
 *  titik koma. Koma TIDAK memisah — bisa bagian nama part. "-" / kosong = tidak ada penggantian. */
export function pecahSparepart(teks: string | null | undefined): string[] {
  return (teks ?? "").split(/\s+·\s+|\n+|;/).map((x) => x.trim()).filter((x) => x && x !== "-");
}
