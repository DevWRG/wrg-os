// DOC — Document Tracker 9-state machine. Logika MURNI (tanpa DB), diuji di doc-tracker-state.test.ts.
//
// 9 state (urutan dari foto rapat 2026-10-27, dikonfirmasi user):
//   Draft → Review → Approved → Sent → Received → Executed → Billed → Paid → Closed
// Unit = satu Sales Order Accurate. State BUKAN disimpan: dihitung dari bukti yang sudah ada
// (SJ/pengiriman/BAST/faktur dari mirror + shipment_tracking) plus dua stempel manual
// (Review, Approved) dan checklist tanda tangan dokumen.
//
// Aturan: state = tahap BERURUTAN terjauh yang buktinya lengkap. Bukti di tahap lebih jauh
// sementara tahap sebelumnya kosong = ANOMALI ("dokumen kurang") — inti cross-check-nya
// ("sudah dikirim, sudah dibayar belum"). SO dengan banyak SJ/faktur: tahap pengiriman baru
// terpenuhi bila SEMUA SJ-nya sudah melewatinya; Paid bila SEMUA faktur lunas.
// TTF sengaja tidak ada (keputusan Direktur di F12/F42/F31).

export const STATES = ["draft", "review", "approved", "sent", "received", "executed", "billed", "paid", "closed"] as const;
export type DocState = (typeof STATES)[number];

export const LABEL_STATE: Record<DocState, string> = {
  draft: "Draft",
  review: "Review",
  approved: "Approved",
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

/** Hari setelah BAST tanpa faktur sebelum ditandai berisiko ditagih terlambat (override env DOC_TRACKER_BILLING_HARI). */
export const HARI_BILLING_RISIKO = 3;
export const hariBillingRisiko = (): number => {
  const n = Number(process.env.DOC_TRACKER_BILLING_HARI);
  return Number.isFinite(n) && n >= 0 ? n : HARI_BILLING_RISIKO;
};

export interface SjBukti {
  nomor: string;
  kirimAt: string | null;
  terimaAt: string | null;
  bastAt: string | null;
}

export interface FakturBukti {
  nomor: string;
  tanggal: string; // YYYY-MM-DD
  lunas: boolean;
  lunasAt?: string | null;
}

export interface Snapshot {
  soTanggal: string; // YYYY-MM-DD
  reviewAt: string | null;
  approvedAt: string | null;
  sj: SjBukti[];
  faktur: FakturBukti[];
  dokumen: Partial<Record<JenisDokumen, boolean>>;
  /**
   * true = Review/Approved wajib bertanda. false (SO sebelum tracker hidup) = dianggap TERSIRAT bila
   * bukti hilir ada — kalau tidak, ±500 SO lama semuanya "Draft" dengan anomali palsu.
   */
  stempelWajib: boolean;
  today: string; // YYYY-MM-DD (WIB)
}

export interface TahapInfo {
  selesai: boolean;
  /** Kapan tahap terpenuhi (ISO/tanggal); null bila tak diketahui. */
  at: string | null;
  /** Terpenuhi karena tahap hilir ada, bukan karena stempel (hanya Review/Approved SO lama). */
  tersirat?: boolean;
}

export interface HasilState {
  state: DocState;
  tahap: Record<DocState, TahapInfo>;
  anomali: string[];
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

export function hitungState(s: Snapshot): HasilState {
  const n = s.sj.length;
  const kirim = s.sj.filter((x) => x.kirimAt).length;
  const terima = s.sj.filter((x) => x.terimaAt).length;
  const bast = s.sj.filter((x) => x.bastAt).length;
  const lunas = s.faktur.filter((f) => f.lunas).length;
  const hitungan = { sj: n, kirim, terima, bast, faktur: s.faktur.length, lunas };

  const bukti: Record<"sent" | "received" | "executed" | "billed" | "paid", TahapInfo> = {
    sent: { selesai: n > 0 && kirim === n, at: n > 0 && kirim === n ? maxStr(s.sj.map((x) => x.kirimAt)) : null },
    received: { selesai: n > 0 && terima === n, at: n > 0 && terima === n ? maxStr(s.sj.map((x) => x.terimaAt)) : null },
    executed: { selesai: n > 0 && bast === n, at: n > 0 && bast === n ? maxStr(s.sj.map((x) => x.bastAt)) : null },
    billed: { selesai: s.faktur.length > 0, at: minStr(s.faktur.map((f) => f.tanggal)) },
    paid: {
      selesai: s.faktur.length > 0 && lunas === s.faktur.length,
      at: s.faktur.length > 0 && lunas === s.faktur.length ? maxStr(s.faktur.map((f) => f.lunasAt ?? null)) : null,
    },
  };
  const hilirAda = bukti.sent.selesai || bukti.received.selesai || bukti.executed.selesai || bukti.billed.selesai || bukti.paid.selesai || kirim + terima + bast > 0;

  const stempel = (at: string | null): TahapInfo => {
    if (at) return { selesai: true, at };
    if (!s.stempelWajib && hilirAda) return { selesai: true, at: null, tersirat: true };
    return { selesai: false, at: null };
  };
  const review = stempel(s.reviewAt);
  // Approved tanpa Review tercatat = anomali, kecuali SO lama (tersirat mengikuti hilir).
  const approved = stempel(s.approvedAt);

  const dokumenKurang = DOKUMEN_WAJIB.filter((j) => !s.dokumen[j]);
  const closedSelesai = bukti.paid.selesai && dokumenKurang.length === 0;

  const tahap: Record<DocState, TahapInfo> = {
    draft: { selesai: true, at: s.soTanggal },
    review,
    approved,
    sent: bukti.sent,
    received: bukti.received,
    executed: bukti.executed,
    billed: bukti.billed,
    paid: bukti.paid,
    closed: { selesai: closedSelesai, at: closedSelesai ? bukti.paid.at : null },
  };

  let idx = 0;
  while (idx + 1 < STATES.length && tahap[STATES[idx + 1]].selesai) idx++;
  const state = STATES[idx];

  // Anomali: bukti pada tahap lebih jauh daripada state berurutan. Closed tak dihitung (turunan Paid + dokumen).
  const terjauh = STATES.reduce((acc, st, i) => (st !== "closed" && tahap[st].selesai ? i : acc), 0);
  const anomali: string[] = [];
  for (let i = idx + 1; i < terjauh; i++) {
    const st = STATES[i];
    if (!tahap[st].selesai) anomali.push(`${LABEL_STATE[STATES[terjauh]]} tercatat tetapi ${LABEL_STATE[st]} belum`);
  }

  const tglBast = tanggalWib(bukti.executed.at);
  const billingRisiko =
    bukti.executed.selesai && !bukti.billed.selesai && tglBast !== null && selisihHari(tglBast, s.today) > hariBillingRisiko();

  const at = tahap[state].at;
  const tgl = tanggalWib(at);
  return { state, tahap, anomali, dokumenKurang, billingRisiko, umurHari: tgl ? Math.max(0, selisihHari(tgl, s.today)) : null, hitungan };
}
