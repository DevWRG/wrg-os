// F19 — label alasan "near_ed" di halaman Forecast Submission. Engine
// (apps/api repo/forecast.ts findEdNear) juga menjaring batch yang SUDAH
// lewat ED; dulu semuanya berlabel "mendekati ED".

/** Tanggal lokal YYYY-MM-DD (bukan toISOString — itu UTC, mundur sehari 00–07 WIB). */
export function tanggalLokalIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ED terdekat (YYYY-MM-DD…) sudah lewat dibanding todayIso (YYYY-MM-DD). */
export function edSudahLewat(nearestEd: string | null | undefined, todayIso: string): boolean {
  return !!nearestEd && nearestEd.slice(0, 10) < todayIso;
}
