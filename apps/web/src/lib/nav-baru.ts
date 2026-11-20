// Lencana "NEW" di sidebar BERBATAS WAKTU. Dulu 88 dari 123 menu berlabel NEW
// selamanya (termasuk fitur live sejak Oktober), jadi lencana tak lagi berarti
// apa-apa. Sekarang NEW tampil hanya BARU_HARI hari sejak menu itu rilis ke
// produksi (tanggal = commit pertama url-nya di nav.ts cabang main).
//
// Menu baru: tambah barisnya di RILIS saat dipromosikan ke main. Menu ber-
// `badge: "NEW"` tanpa entri di sini tidak menampilkan lencana — `badge` lain
// (bukan "NEW") tetap tampil apa adanya.

export const BARU_HARI = 14;

export const RILIS: Record<string, string> = {
  "/proyek-hd": "2026-11-19",
  "/hd-simulator": "2026-11-19",
  "/riwayat-alat": "2026-11-17",
  "/kinerja-teknisi": "2026-11-16",
  "/forecast-submission": "2026-11-16",
  "/direktur-inbox": "2026-11-11",
  "/bon-sparepart": "2026-11-11",
  "/service-tickets": "2026-11-10",
  "/readiness-board": "2026-11-10",
  "/maintenance": "2026-11-10",
  "/installations": "2026-11-10",
  "/pmf-scorecard": "2026-11-09",
  "/kohort": "2026-11-09",
  "/kas-station": "2026-11-09",
  "/ap-three-way": "2026-11-09",
  "/report-library": "2026-11-08",
  "/register-cek": "2026-11-08",
  "/profitabilitas-area": "2026-11-08",
  "/penerbitan-faktur": "2026-11-08",
  "/doc-tracker": "2026-11-08",
  "/cn": "2026-11-08",
  "/bukti-pembayaran": "2026-11-08",
  "/do-belum-faktur": "2026-11-07",
  "/arsip-dokumen": "2026-11-06",
  "/status-job": "2026-11-04",
  "/sales-command": "2026-11-04",
  "/order-wa": "2026-11-03",
};

export function lencanaMenu(url: string, badge: string | undefined, now: Date = new Date()): string | null {
  if (!badge) return null;
  if (badge !== "NEW") return badge;
  const rilis = RILIS[url];
  if (!rilis) return null;
  // Hari kalender (WIB) sejak rilis: hari rilis = 0, hari ke-14 masih tampil.
  const umurHari = Math.floor((now.getTime() - new Date(`${rilis}T00:00:00+07:00`).getTime()) / 86_400_000);
  return umurHari >= 0 && umurHari <= BARU_HARI ? "NEW" : null;
}
