// DOC — Document Tracker 7-state machine. Logika MURNI (tanpa DB), diuji di doc-tracker-state.test.ts.
//
// 7 state (keputusan user 8 Nov 2026 — Review & Approved dihapus dari 9 state rapat 2026-10-27):
//   Draft → Sent → Received → Executed → Billed → Paid → Closed
// Alasan Review/Approved dihapus: Accurate menandai SEMUA SO approvalStatus=APPROVED (tak ada alur
// persetujuan), stempel manual hampir tak pernah dipakai, dan persetujuan sebenarnya terjadi di hulu
// (SPH/pipeline). Tabel doc_tracker_stamp (migrasi 258) tak lagi dibaca/ditulis.
// Unit = satu Sales Order Accurate. State BUKAN disimpan: dihitung dari bukti yang sudah ada
// (SJ/pengiriman/BAST/faktur dari mirror + shipment_tracking + installation_unit) plus checklist dokumen
// (manual ∪ otomatis dari Arsip F156).
//
// Aturan: state = tahap TERJAUH yang buktinya ada (Draft selalu). Tahap di antaranya yang tak berbukti
// TIDAK menahan SO — didaftar di `belumTercatat` (informasi).
// Sent = SJ (DO) Accurate untuk SO itu sudah terbit — DO terbit = barang keluar dari sudut pandang
// sistem; kirim_at WA hanya menambah waktu. Received/Executed tetap butuh terima_at/BAST SEMUA SJ.
// BAST satu SJ = BAST WA (#BAST, shipment_tracking.bast_at) ATAU BAST Instalasi Aftersales
// (installation_unit.bast_done) — mana yang lebih dulu.
// Paid bila SEMUA faktur lunas; Closed = Paid + dokumen wajib lengkap.
// Anomali tinggal satu jenis: sudah lunas tetapi dokumen wajib belum lengkap (yang menahan Closed).
// TTF sengaja tidak ada (keputusan Direktur di F12/F42/F31).

export const STATES = ["draft", "sent", "received", "executed", "billed", "paid", "closed"] as const;
export type DocState = (typeof STATES)[number];

export const LABEL_STATE: Record<DocState, string> = {
  draft: "Draft",
  sent: "Sent",
  received: "Received",
  executed: "Executed",
  billed: "Billed",
  paid: "Paid",
  closed: "Closed",
};

export type JenisDokumen = "po_customer" | "sj_ttd_gudang" | "sj_ttd_sales" | "sj_ttd_kepala_sales" | "sj_ttd_teknisi";
export const JENIS_DOKUMEN: readonly JenisDokumen[] = ["po_customer", "sj_ttd_gudang", "sj_ttd_sales", "sj_ttd_kepala_sales", "sj_ttd_teknisi"];
/** Wajib untuk Closed. Teknisi hanya informasi (khusus alat). Asumsi — konfirmasi Husni. */
export const DOKUMEN_WAJIB: readonly JenisDokumen[] = ["po_customer", "sj_ttd_gudang", "sj_ttd_sales", "sj_ttd_kepala_sales"];
const LABEL_DOKUMEN: Record<JenisDokumen, string> = {
  po_customer: "PO customer",
  sj_ttd_gudang: "SJ ttd Gudang",
  sj_ttd_sales: "SJ ttd Sales",
  sj_ttd_kepala_sales: "SJ ttd Kepala Sales",
  sj_ttd_teknisi: "ttd Teknisi",
};

/** Hari setelah BAST tanpa faktur sebelum ditandai berisiko ditagih terlambat (override env DOC_TRACKER_BILLING_HARI). */
export const HARI_BILLING_RISIKO = 3;
export const hariBillingRisiko = (): number => {
  const n = Number(process.env.DOC_TRACKER_BILLING_HARI);
  return Number.isFinite(n) && n >= 0 ? n : HARI_BILLING_RISIKO;
};

export interface SjBukti {
  nomor: string;
  /** Tanggal DO Accurate (YYYY-MM-DD) — waktu Sent bila kirim_at WA kosong. */
  tanggal?: string | null;
  kirimAt: string | null;
  terimaAt: string | null;
  /** BAST dari WA #BAST (shipment_tracking.bast_at). */
  bastAt: string | null;
  /** BAST dari Instalasi Aftersales (installation_unit.bast_at, bast_done=true) untuk nomor SJ ini. */
  bastInstalasiAt?: string | null;
}

export interface FakturBukti {
  nomor: string;
  tanggal: string; // YYYY-MM-DD
  lunas: boolean;
  lunasAt?: string | null;
}

export interface Snapshot {
  soTanggal: string; // YYYY-MM-DD
  sj: SjBukti[];
  faktur: FakturBukti[];
  /** Sudah digabung: centang manual ATAU otomatis dari Arsip (lihat gabungDokumen). */
  dokumen: Partial<Record<JenisDokumen, boolean>>;
  today: string; // YYYY-MM-DD (WIB)
}

export interface TahapInfo {
  selesai: boolean;
  /** Kapan tahap terpenuhi (ISO/tanggal); null bila tak diketahui. */
  at: string | null;
}

export interface HasilState {
  state: DocState;
  tahap: Record<DocState, TahapInfo>;
  anomali: string[];
  /** Tahap sebelum state sekarang yang buktinya tak ada — informasi, tidak menahan state. */
  belumTercatat: DocState[];
  dokumenKurang: JenisDokumen[];
  billingRisiko: boolean;
  /** Hari sejak masuk state sekarang; null bila waktunya tak diketahui. */
  umurHari: number | null;
  hitungan: { sj: number; kirim: number; terima: number; bast: number; faktur: number; lunas: number };
}

const maxStr = (xs: (string | null | undefined)[]): string | null => {
  const v = xs.filter((x): x is string => !!x).sort();
  return v.length ? v[v.length - 1] : null;
};
const minStr = (xs: (string | null | undefined)[]): string | null => {
  const v = xs.filter((x): x is string => !!x).sort();
  return v.length ? v[0] : null;
};

/** ISO timestamptz → tanggal WIB (YYYY-MM-DD); string tanggal polos dikembalikan apa adanya. */
export function tanggalWib(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t + 7 * 3600_000).toISOString().slice(0, 10) : null;
}

export function selisihHari(dari: string, sampai: string): number {
  return Math.floor((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);
}

/** BAST satu SJ: WA atau Instalasi, yang lebih dulu. */
export function bastSj(x: SjBukti): { at: string | null; sumber: "wa" | "instalasi" | null } {
  const wa = x.bastAt ?? null;
  const ins = x.bastInstalasiAt ?? null;
  if (wa && ins) return Date.parse(ins) < Date.parse(wa) ? { at: ins, sumber: "instalasi" } : { at: wa, sumber: "wa" };
  if (wa) return { at: wa, sumber: "wa" };
  if (ins) return { at: ins, sumber: "instalasi" };
  return { at: null, sumber: null };
}

export function hitungState(s: Snapshot): HasilState {
  const n = s.sj.length;
  const kirim = s.sj.filter((x) => x.kirimAt).length;
  const terima = s.sj.filter((x) => x.terimaAt).length;
  const bastAt = s.sj.map((x) => bastSj(x).at);
  const bast = bastAt.filter((x) => x).length;
  const lunas = s.faktur.filter((f) => f.lunas).length;
  const hitungan = { sj: n, kirim, terima, bast, faktur: s.faktur.length, lunas };

  // Sent: DO terbit = terkirim dari sudut pandang sistem (kirim_at WA kebanyakan kosong).
  // Waktu = kirim_at bila ada, kalau tidak tanggal DO; diambil yang terakhir di antara SJ.
  const bukti: Record<"sent" | "received" | "executed" | "billed" | "paid", TahapInfo> = {
    sent: { selesai: n > 0, at: n > 0 ? maxStr(s.sj.map((x) => x.kirimAt ?? x.tanggal ?? null)) : null },
    received: { selesai: n > 0 && terima === n, at: n > 0 && terima === n ? maxStr(s.sj.map((x) => x.terimaAt)) : null },
    executed: { selesai: n > 0 && bast === n, at: n > 0 && bast === n ? maxStr(bastAt) : null },
    billed: { selesai: s.faktur.length > 0, at: minStr(s.faktur.map((f) => f.tanggal)) },
    paid: {
      selesai: s.faktur.length > 0 && lunas === s.faktur.length,
      at: s.faktur.length > 0 && lunas === s.faktur.length ? maxStr(s.faktur.map((f) => f.lunasAt ?? null)) : null,
    },
  };
  const dokumenKurang = DOKUMEN_WAJIB.filter((j) => !s.dokumen[j]);
  const closedSelesai = bukti.paid.selesai && dokumenKurang.length === 0;

  const tahap: Record<DocState, TahapInfo> = {
    draft: { selesai: true, at: s.soTanggal },
    sent: bukti.sent,
    received: bukti.received,
    executed: bukti.executed,
    billed: bukti.billed,
    paid: bukti.paid,
    closed: { selesai: closedSelesai, at: closedSelesai ? bukti.paid.at : null },
  };

  // State = tahap TERJAUH yang berbukti; tahap kosong di bawahnya hanya dicatat, tidak menahan.
  const idx = STATES.reduce((acc, st, i) => (tahap[st].selesai ? i : acc), 0);
  const state = STATES[idx];
  const belumTercatat = STATES.slice(1, idx).filter((st) => !tahap[st].selesai);

  const anomali: string[] = [];
  if (bukti.paid.selesai && dokumenKurang.length > 0) {
    anomali.push(`Lunas tetapi dokumen wajib belum lengkap: ${dokumenKurang.map((j) => LABEL_DOKUMEN[j]).join(", ")}`);
  }

  const tglBast = tanggalWib(bukti.executed.at);
  const billingRisiko =
    bukti.executed.selesai && !bukti.billed.selesai && tglBast !== null && selisihHari(tglBast, s.today) > hariBillingRisiko();

  const at = tahap[state].at;
  const tgl = tanggalWib(at);
  return { state, tahap, anomali, belumTercatat, dokumenKurang, billingRisiko, umurHari: tgl ? Math.max(0, selisihHari(tgl, s.today)) : null, hitungan };
}

// ── Checklist dokumen otomatis dari Arsip F156 ─────────────────────────────────────────────────────────

/** Satu baris arsip_dokumen (belum dihapus) yang rujukannya cocok dengan SJ/faktur SO. */
export interface ArsipRujukan {
  nomor: string;
  buku_kode: string;
  ref_sj: string | null;
  ref_po: string | null;
  ref_faktur: string | null;
}

/** Nomor dokumen untuk dicocokkan: dipangkas + tak peka huruf. */
export const kunciNomor = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

/**
 * Jenis dokumen yang tercentang otomatis dari Arsip, beserta nomor arsip sumbernya.
 * - Scan SJ ber-ttd (buku SJ, ref_sj = nomor SJ SO) → sj_ttd_gudang/sales/kepala_sales sekaligus (satu scan
 *   SJ bertanda tangan mewakili ketiganya). SO dengan beberapa SJ: SEMUA SJ harus punya arsip SJ.
 * - Arsip (buku apa pun) yang membawa ref_po DAN merujuk SJ atau faktur SO ini → po_customer.
 * ttd Teknisi tidak pernah otomatis (informasi, diisi manual).
 */
export function dokumenDariArsip(sjNomor: string[], fakturNomor: string[], arsip: ArsipRujukan[]): Partial<Record<JenisDokumen, string[]>> {
  const sjSet = new Set(sjNomor.map(kunciNomor).filter(Boolean));
  const fakSet = new Set(fakturNomor.map(kunciNomor).filter(Boolean));
  const hasil: Partial<Record<JenisDokumen, string[]>> = {};

  const arsipSj = arsip.filter((a) => kunciNomor(a.buku_kode) === "SJ" && sjSet.has(kunciNomor(a.ref_sj)));
  const sjTerarsip = new Set(arsipSj.map((a) => kunciNomor(a.ref_sj)));
  if (sjSet.size > 0 && [...sjSet].every((n) => sjTerarsip.has(n))) {
    const nomor = [...new Set(arsipSj.map((a) => a.nomor))].sort();
    hasil.sj_ttd_gudang = nomor;
    hasil.sj_ttd_sales = nomor;
    hasil.sj_ttd_kepala_sales = nomor;
  }

  const po = arsip.filter((a) => kunciNomor(a.ref_po) !== "" && (sjSet.has(kunciNomor(a.ref_sj)) || fakSet.has(kunciNomor(a.ref_faktur))));
  if (po.length) hasil.po_customer = [...new Set(po.map((a) => a.nomor))].sort();
  return hasil;
}

/** Centang akhir = manual ATAU Arsip. Manual "tidak ada" tak bisa membatalkan bukti Arsip. */
export function gabungDokumen(
  manual: Partial<Record<JenisDokumen, boolean>>,
  arsip: Partial<Record<JenisDokumen, string[]>>,
): Partial<Record<JenisDokumen, boolean>> {
  const out: Partial<Record<JenisDokumen, boolean>> = {};
  for (const j of JENIS_DOKUMEN) {
    const v = manual[j] === true || (arsip[j]?.length ?? 0) > 0;
    if (v || j in manual) out[j] = v;
  }
  return out;
}
