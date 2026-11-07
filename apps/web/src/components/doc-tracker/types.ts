// Tipe di-mirror dari apps/api/src/repo/doc-tracker.ts & doc-tracker-state.ts.
export const STATES = ["draft", "review", "approved", "sent", "received", "executed", "billed", "paid", "closed"] as const;
export type DocState = (typeof STATES)[number];

export const LABEL_STATE: Record<DocState, string> = {
  draft: "Draft", review: "Review", approved: "Approved", sent: "Sent", received: "Received",
  executed: "Executed", billed: "Billed", paid: "Paid", closed: "Closed",
};

/** Arti tiap state untuk orang lapangan (bukan istilah teknis state machine). */
export const KETERANGAN_STATE: Record<DocState, string> = {
  draft: "Order masuk sistem",
  review: "Sudah direview",
  approved: "Disetujui",
  sent: "SJ dikirim",
  received: "Diterima customer",
  executed: "BAST / penyerahan",
  billed: "Faktur terbit",
  paid: "Faktur lunas",
  closed: "Dokumen lengkap, selesai",
};

export type JenisDokumen = "po_customer" | "sj_ttd_gudang" | "sj_ttd_sales" | "sj_ttd_kepala_sales" | "sj_ttd_teknisi";
export const LABEL_DOKUMEN: Record<JenisDokumen, string> = {
  po_customer: "PO customer",
  sj_ttd_gudang: "SJ ditandatangani Gudang",
  sj_ttd_sales: "SJ ditandatangani Sales",
  sj_ttd_kepala_sales: "SJ ditandatangani Kepala Sales",
  sj_ttd_teknisi: "Penyerahan ditandatangani Teknisi (alat)",
};

export interface Hitungan { sj: number; kirim: number; terima: number; bast: number; faktur: number; lunas: number }

export interface DocRow {
  so_id: number;
  so_number: string;
  tanggal: string;
  customer: string;
  total: number | null;
  state: DocState;
  umur_hari: number | null;
  anomali: string[];
  dokumen_kurang: JenisDokumen[];
  billing_risiko: boolean;
  dikirim_belum_dibayar: boolean;
  hitungan: Hitungan;
}

export interface DocTrackerList {
  asOf: string;
  hari: number;
  hari_billing_risiko: number;
  stempel_mulai: string;
  funnel: Record<DocState, number>;
  ringkas: { total: number; anomali: number; billing_risiko: number; dikirim_belum_dibayar: number };
  rows: DocRow[];
}

export interface TahapInfo { selesai: boolean; at: string | null; tersirat?: boolean }

export interface DocDetail {
  so: { id: number; number: string; tanggal: string; customer: string; customer_id: number | null; total: number | null; status: string | null };
  hasil: {
    state: DocState;
    tahap: Record<DocState, TahapInfo>;
    anomali: string[];
    dokumenKurang: JenisDokumen[];
    billingRisiko: boolean;
    umurHari: number | null;
    hitungan: Hitungan;
  };
  sj: { nomor: string; kirimAt: string | null; terimaAt: string | null; bastAt: string | null }[];
  faktur: { invoice_id: number; nomor: string; tanggal: string; lunas: boolean }[];
  stempel: Record<"review" | "approved", { at: string; by: string; catatan: string | null } | null>;
  dokumen: Record<JenisDokumen, { ada: boolean; by: string; at: string } | null>;
  dokumen_wajib: JenisDokumen[];
  kandidat_faktur: { invoice_id: number; nomor: string; tanggal: string; total: number }[];
}

export async function ambil<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error === "migration_pending" ? "Migrasi 258 belum diterapkan." : (body?.error ?? `HTTP ${res.status}`));
  return body;
}

export const rp = (n: number | null | undefined) => (n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`);
export const waktu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "—";
