// Susunan sidebar yang DITAMPILKAN (evaluasi menu 19 Nov 2026, tahap 2): grup per
// pekerjaan/departemen dalam bahasa Indonesia + nama menu seragam.
//
// Sengaja lapisan TAMPILAN di atas NAV, bukan mengubah nav.ts:
//   - katalog izin (featureCatalog: key, nama, section) tak berubah → tanpa Sync
//     Fitur, matriks Akses Grup tetap seperti sekarang;
//   - homePath() memakai urutan NAV → halaman rumah tiap orang tak ikut berubah;
//   - nav.ts di dev & main berbeda isi; peta ini cukup disalin apa adanya.
// Menu yang tak tercantum di sini tetap tampil di grup aslinya, di akhir sidebar —
// menu baru tak pernah hilang hanya karena lupa ditambahkan ke peta.

import type { NavGroup, NavItem } from "./nav";

export const GRUP_TAMPIL: { label: string; urls: string[] }[] = [
  { label: "Saya", urls: ["/me", "/raport", "/insentif", "/npk/self", "/npk/am-self"] },
  { label: "Dasbor", urls: ["/overview", "/executive", "/watchpoint", "/sales-command", "/direktur-inbox", "/approval-requests", "/briefings"] },
  { label: "Plan & Report", urls: ["/plan-report", "/calendar", "/visits", "/todos", "/reminders"] },
  { label: "Penjualan", urls: ["/pipeline", "/customers", "/accounts", "/ar", "/sales-docs", "/order-wa", "/demo-trial", "/permintaan-produk", "/lpse-tender", "/insentif/tim"] },
  { label: "Marketing", urls: ["/kampanye", "/pameran", "/brosur", "/competitor"] },
  { label: "Analitik", urls: ["/sales-analytics", "/sales-alerts", "/product-scorecard", "/revenue-stream", "/pmf-scorecard", "/kohort", "/profitabilitas-area", "/report-library"] },
  { label: "Produk & Harga", urls: ["/pricebook", "/pricebook/ringkasan", "/pricebook/setup", "/klasifikasi-produk", "/products", "/inventory"] },
  { label: "KSO & HD", urls: ["/kso-komite", "/kso-kontrak", "/kso-alat", "/kso-produktivitas", "/kso-simulator", "/proyek-hd", "/hd-simulator"] },
  { label: "Aftersales & Teknisi", urls: ["/installations", "/readiness-board", "/service-tickets", "/maintenance", "/jadwal-teknisi", "/kinerja-teknisi", "/riwayat-alat", "/bon-sparepart", "/proficiency-tests"] },
  { label: "Gudang & Pembelian", urls: ["/stok-gudang", "/ed-watch", "/purchase-orders", "/inbound-receiving", "/forecast-submission", "/supplier-eta", "/suppliers"] },
  { label: "Pengiriman & Dokumen", urls: ["/orders", "/shipments", "/shipment-tracking", "/courier-performance", "/pickup-plan", "/doc-tracker", "/arsip-dokumen", "/print-spec"] },
  { label: "Keuangan", urls: ["/uang-masuk", "/do-belum-faktur", "/penerbitan-faktur", "/collection-drafts", "/cn", "/doc-klaim", "/ap-three-way", "/register-cek", "/kas-station", "/bukti-pembayaran", "/aset-tetap"] },
  { label: "General Affairs", urls: ["/ga-helpdesk", "/fund-requests", "/dana-ops", "/ga-aset", "/ga-relokasi", "/asset-tag", "/vehicles", "/atk-stock-out", "/atk-master", "/atk-stock-in", "/atk-stock-opname", "/vendor-management", "/ga-reporting"] },
  { label: "SDM & Organisasi", urls: ["/leave", "/holidays", "/overtime", "/onboarding", "/karyawan", "/coaching", "/npk", "/npk/am", "/people/org", "/people/raci", "/sop-otomasi", "/network", "/people/voice"] },
  { label: "Pengawasan", urls: ["/monitor/rekap", "/monitor/resume", "/monitor/pola", "/monitor/members", "/digests", "/hitl", "/audit-findings"] },
  { label: "Admin", urls: ["/users", "/am-cabang", "/user-access", "/access-groups", "/sales/targets", "/people/hod-resolve", "/status-job", "/settings"] },
];

// Nama tampil seragam (url & key tetap). Istilah domain (SO, DO, KSO, AR, HPP, NPK,
// PMF) dipertahankan. K10 opsi C: empat menu NPK tetap, namanya dibedakan jelas.
// K11 opsi B: Cuti dan Hari Libur tetap dua menu.
export const NAMA_TAMPIL: Record<string, string> = {
  "/plan-report": "Ringkasan Plan & Report",
  "/todos": "Plan Operasional",
  "/visits": "Plan Kunjungan",
  "/reminders": "Pengingat",
  "/leave": "Cuti & Izin",
  "/holidays": "Hari Libur Nasional",
  "/overtime": "Lembur",
  "/npk": "NPK HoD (Tim)",
  "/npk/self": "NPK Saya (HoD)",
  "/npk/am": "NPK AM (Tim)",
  "/npk/am-self": "NPK Saya (AM)",
  "/courier-performance": "Kinerja Kurir",
  "/monitor/rekap": "Rekap Grup WA",
  "/monitor/resume": "Resume Harian (AI)",
  "/monitor/pola": "Pola Komunikasi",
  "/monitor/members": "Anggota Grup WA",
  "/users": "Pengguna (Roster)",
  "/user-access": "Akun Login",
  "/settings": "Pengaturan",
  "/sales/targets": "Target Sales",
  "/orders": "Sales Order (Accurate)",
  "/shipments": "Surat Jalan / DO (Accurate)",
  "/suppliers": "Supplier (Accurate)",
  "/fund-requests": "Ajukan Dana Operasional",
  "/dana-ops": "Realisasi Dana Ops",
  "/ga-reporting": "Laporan GA",
};

export function namaMenu(it: Pick<NavItem, "url" | "title">): string {
  return NAMA_TAMPIL[it.url] ?? it.title;
}

// NAV (yang sudah disaring izin) → grup tampil. Urutan item mengikuti peta.
export function susunNav(nav: NavGroup[]): NavGroup[] {
  const byUrl = new Map<string, NavItem>();
  for (const g of nav) for (const it of g.items) byUrl.set(it.url, it);
  const dipakai = new Set<string>();
  const hasil: NavGroup[] = [];
  for (const g of GRUP_TAMPIL) {
    const items = g.urls.flatMap((u) => {
      const it = byUrl.get(u);
      if (!it || dipakai.has(u)) return [];
      dipakai.add(u);
      return [{ ...it, title: namaMenu(it) }];
    });
    if (items.length) hasil.push({ label: g.label, items });
  }
  // Menu di luar peta → tetap di grup aslinya, di akhir.
  for (const g of nav) {
    const sisa = g.items.filter((it) => !dipakai.has(it.url)).map((it) => ({ ...it, title: namaMenu(it) }));
    if (sisa.length) hasil.push({ label: g.label, items: sisa });
  }
  return hasil;
}
