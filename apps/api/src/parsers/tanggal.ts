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
 * Batas kewajaran ke MASA LAMPAU, dalam hari. Dipilih 180: seluruh kesalahan
 * tahun yang teramati minimal 365 hari (2025→2026, 2027→2026, tahun 202 =
 * ribuan tahun), jadi 180 menangkap semuanya sambil tetap memberi ruang lebar
 * untuk entri backdate yang sah (teramati sampai -31 hari).
 */
export const PLAUSIBLE_DAYS = 180;

/**
 * Batas kewajaran ke MASA DEPAN, dalam hari — jauh lebih ketat daripada sisi
 * lampau, dan itu disengaja.
 *
 * Jaring lama simetris ±180 hari. Akibatnya tanggal masa depan yang "dekat"
 * lolos: `#REPORT` bertanggal sebulan ke depan diterima apa adanya, barisnya
 * duduk di masa depan, dan TIDAK AKAN PERNAH cocok ke plan mana pun — kelas
 * kegagalan yang sama dengan bug tahun, hanya jaraknya lebih kecil sehingga
 * tak tertangkap. (Kejadian nyata: 6 baris activity_log am 18 bertanggal
 * 2027-07-27 dari pesan 2026-07-27, dibersihkan manual 2026-08-20.)
 *
 * Angka 7 diambil dari data produksi, bukan tebakan: dari 3.652 baris
 * `sales_plan` bertanggal-submit, NOL bertanggal masa depan; `sales_todo` hanya
 * 5 baris di +1 hari (plan besok). Semua kesalahan yang teramati >= 30 hari.
 * Jadi 7 memberi ruang seminggu untuk perencanaan maju sambil tetap menangkap
 * setiap kesalahan yang pernah terjadi.
 */
export const MAX_FUTURE_DAYS = 7;

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

/**
 * true kalau ISO date wajar relatif hari ini (WIB): sampai PLAUSIBLE_DAYS ke
 * belakang, tapi hanya MAX_FUTURE_DAYS ke depan. Asimetris — lihat alasannya
 * di MAX_FUTURE_DAYS.
 */
export function plausibleIso(iso: string, nowMs: number = Date.now()): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  const today = Math.floor((nowMs + WIB_MS) / DAY_MS) * DAY_MS;
  const selisihHari = (t - today) / DAY_MS;
  return selisihHari <= MAX_FUTURE_DAYS && selisihHari >= -PLAUSIBLE_DAYS;
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
