// Kalender minggu ISO-8601 basis WIB — dipakai bersama papan "sekarang"
// (watchpoint.ts) dan papan mingguan (watchpoint-weekly.ts).
//
// Dipisah ke modul sendiri supaya kedua file itu tidak saling impor: papan
// mingguan sudah mengambil gate & definisi metric dari watchpoint.ts, jadi
// kalau helper kalender tinggal di watchpoint-weekly.ts, memakainya dari
// watchpoint.ts akan membuat siklus impor.
//
// Semua tanggal diperlakukan sebagai hari WIB lalu disimpan sebagai UTC
// midnight, jadi aritmetika tanggal aman dari pergeseran timezone server.

const DAY = 86_400_000;

/** "Hari ini" menurut WIB, sebagai UTC midnight. */
export function wibToday(now: Date = new Date()): Date {
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Senin dari minggu yang memuat `d` (ISO: minggu mulai Senin). */
function mondayOf(d: Date): Date {
  const dow = d.getUTCDay(); // 0=Min
  const shift = dow === 0 ? -6 : 1 - dow;
  return new Date(d.getTime() + shift * DAY);
}

/** Nomor minggu ISO-8601 + tahun ISO-nya (tahun bisa beda dgn tahun kalender di pergantian tahun). */
export function isoWeekOf(d: Date): { isoYear: number; isoWeek: number } {
  // Kamis di minggu yang sama menentukan tahun ISO (definisi ISO-8601).
  const thursday = new Date(mondayOf(d).getTime() + 3 * DAY);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = mondayOf(jan4);
  const isoWeek = Math.round((mondayOf(d).getTime() - week1Monday.getTime()) / (7 * DAY)) + 1;
  return { isoYear, isoWeek };
}

/** Rentang Senin–Minggu untuk (tahun ISO, minggu ISO). */
export function weekRange(isoYear: number, isoWeek: number): { from: string; to: string } {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const monday = new Date(mondayOf(jan4).getTime() + (isoWeek - 1) * 7 * DAY);
  return { from: isoDate(monday), to: isoDate(new Date(monday.getTime() + 6 * DAY)) };
}

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "21–27 Juli 2026" (ringkas bila beda bulan/tahun: "29 Juni – 5 Juli 2026"). */
export function periodeLabel(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  if (sameMonth) return `${a.getUTCDate()}–${b.getUTCDate()} ${BULAN[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${a.getUTCDate()} ${BULAN[a.getUTCMonth()]}${sameYear ? "" : ` ${a.getUTCFullYear()}`}`;
  return `${left} – ${b.getUTCDate()} ${BULAN[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

/** Minggu ISO yang sedang berjalan menurut WIB. */
export function currentWeek(now: Date = new Date()): { isoYear: number; isoWeek: number } {
  return isoWeekOf(wibToday(now));
}

/** Minggu sebelum (year, week) — menyeberangi pergantian tahun dgn benar. */
export function previousWeek(isoYear: number, isoWeek: number): { isoYear: number; isoWeek: number } {
  const { from } = weekRange(isoYear, isoWeek);
  const prevMonday = new Date(new Date(`${from}T00:00:00Z`).getTime() - 7 * DAY);
  return isoWeekOf(prevMonday);
}
