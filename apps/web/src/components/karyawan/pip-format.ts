// Format tampilan F70 (PIP + Improvement). Murni, diuji di pip-format.test.ts.
// Delta = selisih angka skor Raport antar periode — SENGAJA tanpa ambang/label
// "membaik/memburuk" (belum ditentukan Direktur); tanda + / − hanya arah angka.

export type PipStatus = "aktif" | "graduate" | "terminate";

export const PIP_STATUS_LABEL: Record<PipStatus, string> = { aktif: "Aktif", graduate: "Graduate", terminate: "Terminate" };
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
