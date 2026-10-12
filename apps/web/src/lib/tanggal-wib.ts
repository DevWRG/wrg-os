// Tanggal kalender WIB "YYYY-MM-DD". Pengganti d.toISOString().slice(0, 10),
// yang memberi tanggal UTC — antara 00:00–06:59 WIB itu masih kemarin
// (uji dev F43 12 Okt 2026: default tanggal & filter periode mundur sehari).
export function isoWib(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
