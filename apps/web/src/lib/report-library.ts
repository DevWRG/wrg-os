// F92 Report Library (/report-library) — peta 6 laporan ke menu sumbernya + hak akses.
//
// LIHAT MENU — fitur 'report-library' di matriks Akses Grup (tertutup default; butuh
//   Sync Fitur). Sebelum matriks diatur: Direktur + HoD + admin.
// LIHAT TIAP LAPORAN — mengikuti izin MENU SUMBERNYA (WatchPoint, Pipeline, AR, Stok
//   Gudang, Product Scorecard, Customers). Menu ini tak membuka data baru: user yang tak
//   boleh melihat /ar tak akan melihat AR Aging di sini, juga lewat BFF-nya.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "report-library";

export const LAPORAN = [
  { key: "kpi-hod", judul: "KPI per HoD", menu: "/watchpoint", deskripsi: "Metrik vs target tiap Head of Department, bulan berjalan." },
  { key: "pipeline", judul: "Sales Pipeline", menu: "/pipeline", deskripsi: "Deal per stage, nilai total & tertimbang, deal macet." },
  { key: "ar-aging", judul: "AR Aging", menu: "/ar", deskripsi: "Piutang per customer dalam 5 bucket umur + prioritas tagih." },
  { key: "stok", judul: "Stock Status", menu: "/stok-gudang", deskripsi: "Saldo stok per gudang dan cakupan data." },
  { key: "produk", judul: "Product Performance", menu: "/product-scorecard", deskripsi: "Revenue per kategori vs periode sebelumnya & tahun lalu (tanpa margin)." },
  { key: "churn", judul: "Churn Analysis", menu: "/customers", deskripsi: "Customer berhenti order atau frekuensinya turun." },
] as const;

export type KeyLaporan = (typeof LAPORAN)[number]["key"];

export function laporanByKey(key: string) {
  return LAPORAN.find((l) => l.key === key) ?? null;
}

export function canViewReportLibrary(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = (u.role ?? "").trim().toLowerCase();
  const legacy = r === "direktur" || r === "admin" || u.superuser === true
    || u.is_hod === true || (u.title ?? "").trim().toLowerCase().startsWith("hod");
  return canOrLegacy(u, FITUR, legacy);
}
