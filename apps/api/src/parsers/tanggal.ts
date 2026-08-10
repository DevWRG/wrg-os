// Validasi tahun untuk tanggal yang ditulis AM di WA. Dipakai bersama oleh
// dailyplan.ts dan am.ts — dua parser terpisah yang dulu punya salinan logika
// tahun masing-masing dan sama-sama salah.
//
// Latar: 37 baris sales_plan tersimpan dengan tahun ngawur karena `yyyy()` lama
// melewatkan apa pun >= 100 tanpa pemeriksaan dan regex menerima tahun 3 digit:
//   "23/07/202"  -> tahun 202   (AM kehilangan digit 6)   -> 0202-07-22 di DB
//   "16/7/29"    -> tahun 2029  (AM salah ketik 2 digit)
//   "01/08/2027" -> tahun 2027  (AM salah ketik 4 digit)
// AM tidak pernah diberi tahu; barisnya diam-diam nyangkut di masa depan/lampau
// dan tidak akan pernah `reported`.
//
// Tahun 2 digit TIDAK boleh ditolak — 201 pesan nyata memakainya ("07/8/26").

/**
 * Batas kewajaran tanggal plan/report relatif hari ini, dalam hari.
 * Dipilih 180: seluruh kesalahan yang teramati minimal 365 hari (2025→2026,
 * 2027→2026, tahun 202 = ribuan tahun), jadi 180 menangkap semuanya sambil tetap
 * memberi ruang lebar untuk entri backdate yang sah.
 */
export const PLAUSIBLE_DAYS = 180;

const DAY_MS = 86_400_000;
const WIB_MS = 7 * 3600 * 1000;

/** Tahun sekarang menurut WIB. */
export function wibYear(nowMs: number = Date.now()): number {
  return new Date(nowMs + WIB_MS).getUTCFullYear();
}

/**
 * Ekspansi token tahun mentah. 2 digit → 20xx, 4 digit → apa adanya.
 * null untuk 1 atau 3 digit — panjang itu tidak pernah tahun yang disengaja.
 */
export function expandYear(raw: string): number | null {
  if (/^\d{2}$/.test(raw)) return 2000 + Number(raw);
  if (/^\d{4}$/.test(raw)) return Number(raw);
  return null;
}

/** true kalau ISO date masih dalam PLAUSIBLE_DAYS dari hari ini (WIB). */
export function plausibleIso(iso: string, nowMs: number = Date.now()): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const today = Math.floor((nowMs + WIB_MS) / DAY_MS) * DAY_MS;
  return Math.abs(t - today) <= PLAUSIBLE_DAYS * DAY_MS;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Rakit ISO date dari komponen yang sudah diambil regex, dengan dua lapis jaring:
 *
 *  1. token tahun tak terpercaya (1/3 digit) → pakai tahun sekarang
 *  2. hasilnya masih di luar PLAUSIBLE_DAYS → coba ulang dengan tahun sekarang
 *
 * Lapis 2 itu yang memperbaiki seluruh kelas bug: hari & bulan yang diketik AM
 * hampir selalu benar, hanya tahunnya salah — jadi memaksa tahun sekarang
 * mengembalikan tanggal yang AM memang maksudkan ("16/7/29" → 16 Juli tahun ini).
 *
 * null kalau setelah dua lapis itu tanggalnya masih tidak wajar → caller pakai
 * hari ini (perilaku `tanggal: null` yang sudah ada).
 */
export function buildIso(
  day: number,
  month: number,
  yearToken: string | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return null;
  const cur = wibYear(nowMs);
  const parsed = yearToken ? expandYear(yearToken) : cur;
  const iso = `${parsed ?? cur}-${pad(month)}-${pad(day)}`;
  if (plausibleIso(iso, nowMs)) return iso;
  const retry = `${cur}-${pad(month)}-${pad(day)}`;
  return plausibleIso(retry, nowMs) ? retry : null;
}
