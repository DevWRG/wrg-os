/**
 * Alamat foto kunjungan. Dua jalur masuk, dua bentuk berbeda:
 *
 *   • inbound WA  → path media relatif hasil capture openclaw. HARUS lewat
 *     /api/media, yang memvalidasi path di bawah MEDIA_ROOT (anti traversal).
 *   • entri manual → field "URL foto" (input type="url", placeholder
 *     `https://…/foto.jpg`) bisa berisi URL absolut. Dibungkus /api/media?p=…
 *     hasilnya pasti 403 karena di luar MEDIA_ROOT — jadi foto yang diisi lewat
 *     form tidak pernah bisa dibuka sama sekali.
 *
 * Ditaruh di lib (bukan di komponen tabel yang "use client") supaya halaman
 * detail — server component — bisa memakainya tanpa impor lintas boundary.
 */
export const photoHref = (p: string) =>
  /^https?:\/\//i.test(p) ? p : `/api/media?p=${encodeURIComponent(p)}`;
