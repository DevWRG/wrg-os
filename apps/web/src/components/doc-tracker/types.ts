// Tipe di-mirror dari apps/api/src/repo/doc-tracker.ts & doc-tracker-state.ts.
// 7 state — Review/Approved dihapus 8 Nov 2026 (Accurate meng-APPROVED semua SO; persetujuan terjadi di SPH/pipeline).
export const STATES = ["draft", "sent", "received", "executed", "billed", "paid", "closed"] as const;
export type DocState = (typeof STATES)[number];

export const LABEL_STATE: Record<DocState, string> = {
  draft: "Draft", sent: "Sent", received: "Received",
  executed: "Executed", billed: "Billed", paid: "Paid", closed: "Closed",
};

/** Arti tiap state untuk orang lapangan (bukan istilah teknis state machine). */
export const KETERANGAN_STATE: Record<DocState, string> = {
  draft: "Order masuk sistem",
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
  /** Tahap sebelum state yang buktinya tak ada — informasi, tidak menahan state. */
  belum_tercatat: DocState[];
  hitungan: Hitungan;
}

export interface DocTrackerList {
  asOf: string;
  hari: number;
  hari_billing_risiko: number;
  funnel: Record<DocState, number>;
  ringkas: { total: number; anomali: number; billing_risiko: number; dikirim_belum_dibayar: number };
  rows: DocRow[];
}

export interface TahapInfo { selesai: boolean; at: string | null }

export interface SjBukti {
  nomor: string;
  tanggal?: string | null;
  kirimAt: string | null;
  terimaAt: string | null;
  /** BAST WA #BAST. */
  bastAt: string | null;
  /** BAST Instalasi Aftersales untuk nomor SJ ini. */
  bastInstalasiAt?: string | null;
}

export interface DocDetail {
  so: { id: number; number: string; tanggal: string; customer: string; customer_id: number | null; total: number | null; status: string | null };
  hasil: {
    state: DocState;
    tahap: Record<DocState, TahapInfo>;
    anomali: string[];
    belumTercatat: DocState[];
    dokumenKurang: JenisDokumen[];
    billingRisiko: boolean;
    umurHari: number | null;
    hitungan: Hitungan;
  };
  sj: SjBukti[];
  /** otomatis = dari rujukan SO di faktur Accurate (tak bisa dilepas); false = tautan manual. */
  faktur: { invoice_id: number; nomor: string; tanggal: string; lunas: boolean; otomatis: boolean }[];
  /** Centang MANUAL. Centang efektif = manual ATAU dokumen_arsip. */
  dokumen: Record<JenisDokumen, { ada: boolean; by: string; at: string } | null>;
  /** Tercentang otomatis dari Arsip F156 → nomor arsip sumbernya; tak bisa dibatalkan dari sini. */
  dokumen_arsip: Partial<Record<JenisDokumen, string[]>>;
  dokumen_wajib: JenisDokumen[];
  kandidat_faktur: { invoice_id: number; nomor: string; tanggal: string; total: number }[];
}

export async function ambil<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error === "migration_pending" ? "Migrasi 258 belum diterapkan." : (body?.error ?? `HTTP ${res.status}`));
  return body;
}

export const labelTahap = (xs: DocState[]) => xs.map((s) => LABEL_STATE[s]).join(", ");

export const rp = (n: number | null | undefined) => (n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`);
export const waktu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "—";
