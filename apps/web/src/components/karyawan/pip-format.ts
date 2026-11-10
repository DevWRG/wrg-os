// Format tampilan F70 (PIP + Improvement). Murni, diuji di pip-format.test.ts.
// Delta = selisih angka skor Raport antar periode — SENGAJA tanpa ambang/label
// "membaik/memburuk" (belum ditentukan Direktur); tanda + / − hanya arah angka.

export type PipStatus = "aktif" | "graduate" | "terminate";

// Bahasa pemakai (HR/HoD), bukan istilah Inggris: graduate = lulus, terminate = tidak lulus.
export const PIP_STATUS_LABEL: Record<PipStatus, string> = { aktif: "Berjalan", graduate: "Lulus", terminate: "Tidak lulus" };

/** Pilihan hasil akhir PIP (nilai API → label). */
export const OUTCOME_LABEL: Record<"graduate" | "extend" | "terminate", string> = {
  graduate: "Lulus — target tercapai, PIP selesai",
  extend: "Diperpanjang — beri waktu tambahan",
  terminate: "Tidak lulus — lanjut ke tindakan HR",
};

/** Jejak perubahan PIP (audit_log.event_type) → kalimat. Jenis yang tak dikenal tampil apa adanya. */
export const EVENT_LABEL: Record<string, string> = {
  "pip.started": "PIP dimulai",
  "pip.goal_added": "Target perbaikan ditambah",
  "pip.milestone_added": "Tahapan ditambah",
  "pip.milestone_decided": "Status tahapan diubah",
  "pip.checkin_added": "Evaluasi berkala dicatat",
  "pip.outcome_graduate": "Hasil akhir: lulus",
  "pip.outcome_extend": "Hasil akhir: diperpanjang",
  "pip.outcome_terminate": "Hasil akhir: tidak lulus",
};

/** "2026-11-09" → "9 Nov 2026". Bukan tanggal sah → apa adanya. */
export function fmtTgl(t: string | null | undefined): string {
  if (!t) return "–";
  const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export const MILESTONE_LABEL: Record<string, string> = { belum: "Belum", tercapai: "Tercapai", tidak_tercapai: "Tidak tercapai" };

export function fmtScore(n: number | null | undefined): string {
  return n == null ? "–" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);
}

export function fmtDelta(n: number | null | undefined): string {
  if (n == null) return "–";
  const f = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Math.abs(n));
  return n > 0 ? `+${f}` : n < 0 ? `−${f}` : f;
}

export function fmtSisaHari(days: number | null | undefined): string {
  if (days == null) return "";
  if (days < 0) return `lewat ${-days} hari`;
  return days === 0 ? "berakhir hari ini" : `sisa ${days} hari`;
}
