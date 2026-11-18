// Utilitas murni menu Riwayat Alat (F176).

/** Isian yang artinya "tidak ada penggantian" (sering diketik asal di Google Form lama). */
const TANPA_GANTI = /^(?:-+|0+|tidak(?:\s+ada|\s+asa)?|tdk(?:\s+ada)?|nihil|none|n\/?a|kosong|belum\s+ada)$/i;

/** Item sparepart dari teks isian: dipisah " · " (dua kolom Google Form lama digabung impor), baris baru, atau
 *  titik koma. Koma TIDAK memisah — bisa bagian nama part. "-" / "0" / "tidak ada" = tidak ada penggantian. */
export function pecahSparepart(teks: string | null | undefined): string[] {
  return (teks ?? "").split(/\s+·\s+|\n+|;/).map((x) => x.trim()).filter((x) => x && !TANPA_GANTI.test(x));
}

// Bahan habis pakai — "ganti reagen" bukan penggantian sparepart.
const BUKAN_PART = /^(?:reagen|reagent|botol|kertas|thermal\s*paper|paper|faktor|posisi|setting|program|meja)\b/i;

// "persiapan ganti cuvette", "cmos waktunya ganti" = rencana, bukan penggantian yang sudah dilakukan.
const RENCANA = /(?:persiapan|waktunya|perlu|harus|rencana|akan|belum|usul(?:an)?|saran)\s+$/i;

/** Penggantian yang hanya ditulis di kolom Kegiatan ("Ganti lampu, kalibrasi ok…") — banyak laporan Form lama
 *  mengosongkan kolom sparepart. Ambil frasa sesudah "ganti" sampai tanda baca, maks 60 karakter. */
export function gantiDariKegiatan(teks: string | null | undefined): string[] {
  const s = teks ?? "";
  const hasil: string[] = [];
  for (const m of s.matchAll(/\b(?:ganti|penggantian|pergantian|mengganti|diganti)\s+([^,.;:\n()]+)/gi)) {
    if (RENCANA.test(s.slice(0, m.index))) continue;
    const frasa = m[1].trim().replace(/\s+/g, " ");
    if (frasa.length >= 3 && !/^(?:sparepart|part)$/i.test(frasa) && !BUKAN_PART.test(frasa)) hasil.push(frasa.length > 60 ? `${frasa.slice(0, 59)}…` : frasa);
  }
  return hasil;
}
