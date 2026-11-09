// F152 3-Way Match AP — tipe & label bersama (sumber kebenaran: apps/api/src/repo/ap-three-way.ts).
export type StatusBaris =
  | "MATCH" | "PARSIAL" | "SELISIH_QTY" | "SELISIH_HARGA" | "SELISIH_SATUAN"
  | "TANPA_PO" | "TANPA_PENERIMAAN" | "PENERIMAAN_BELUM_FINAL" | "BELUM_SINKRON";
export type StatusFaktur = "MATCH" | "PARSIAL" | "SELISIH" | "BELUM_LENGKAP" | "DRAFT" | "DIABAIKAN";

export interface Temuan { status: StatusBaris; pesan: string }
export interface HasilFaktur { status: StatusFaktur; status_baris: StatusBaris | null; per_status: Partial<Record<StatusBaris, number>>; alasan?: string }
export interface FakturRow {
  accurate_id: number; number: string; bill_number: string | null; vendor_id: number | null; vendor_name: string;
  trans_date: string; due_date: string | null; status_name: string | null; approval_status: string | null;
  total_amount: string | null; hasil: HasilFaktur; jumlah_baris: number; po_numbers: string[]; supplier_docs: string[];
}
export interface BarisRow {
  accurate_detail_id: number; item_no: string | null; item_desc: string; qty: string; return_qty: string;
  unit_name: string | null; unit_price: string | null; disc_raw: string | null; disc_amount: string;
  po_number: string | null; receive_number: string | null; supplier_doc_number: string | null;
  status: StatusBaris; temuan: Temuan[];
}
export type FakturDetail = FakturRow & { description: string | null; baris: BarisRow[] };
export interface Ringkasan { total: number; per_status: Record<StatusFaktur, number> }
export interface ListData {
  items: FakturRow[]; total: number; ringkasan: Ringkasan; terpotong: boolean;
  sinkron: { last_synced_at: string | null; last_run_ok: boolean | null } | null;
}

export const FAKTUR_LABEL: Record<StatusFaktur, string> = {
  MATCH: "Cocok", PARSIAL: "Parsial", SELISIH: "Selisih", BELUM_LENGKAP: "Belum lengkap", DRAFT: "Draft", DIABAIKAN: "Diabaikan",
};
export const FAKTUR_CLS: Record<StatusFaktur, string> = {
  MATCH: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  PARSIAL: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  SELISIH: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  BELUM_LENGKAP: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
  DIABAIKAN: "bg-slate-100 text-slate-500 dark:bg-slate-500/20 dark:text-slate-400",
};
export const BARIS_LABEL: Record<StatusBaris, string> = {
  MATCH: "Cocok", PARSIAL: "Parsial", SELISIH_QTY: "Selisih qty", SELISIH_HARGA: "Selisih harga", SELISIH_SATUAN: "Selisih satuan",
  TANPA_PO: "Tanpa PO", TANPA_PENERIMAAN: "Tanpa penerimaan", PENERIMAAN_BELUM_FINAL: "Penerimaan belum final", BELUM_SINKRON: "Belum sinkron",
};
export const BARIS_CLS: Record<StatusBaris, string> = {
  MATCH: FAKTUR_CLS.MATCH, PARSIAL: FAKTUR_CLS.PARSIAL,
  SELISIH_QTY: FAKTUR_CLS.SELISIH, SELISIH_HARGA: FAKTUR_CLS.SELISIH, SELISIH_SATUAN: FAKTUR_CLS.SELISIH,
  TANPA_PO: FAKTUR_CLS.BELUM_LENGKAP, TANPA_PENERIMAAN: FAKTUR_CLS.BELUM_LENGKAP,
  PENERIMAAN_BELUM_FINAL: FAKTUR_CLS.BELUM_LENGKAP, BELUM_SINKRON: FAKTUR_CLS.BELUM_LENGKAP,
};

export const tglId = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso.slice(0, 10) + "T00:00:00Z")) : "—";
export const rupiah = (v: string | number | null) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(Number(v));
