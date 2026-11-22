import type { DocState } from "./types";

// State tabel Document Tracker yang hidup di URL (halaman server + tampilan klien).
export type Saring = "semua" | "dikirim_belum_dibayar" | "billing" | "anomali";

export interface DocQuery {
  q: string;
  state: DocState | null;
  saring: Saring;
  /** id kolom = DOC_SORTS di apps/api repo/doc-tracker.ts. */
  sort: string;
  dir: "asc" | "desc";
  page: number;
  size: number;
}

/** query tabel → parameter /doc-tracker tanpa limit/offset (dipakai juga ekspor). */
export function paramFilter(q: DocQuery): URLSearchParams {
  const qs = new URLSearchParams();
  if (q.q) qs.set("q", q.q);
  if (q.state) qs.set("state", q.state);
  if (q.saring === "billing") qs.set("billing", "1");
  if (q.saring === "dikirim_belum_dibayar") qs.set("dikirim_belum_dibayar", "1");
  if (q.saring === "anomali") qs.set("anomali", "1");
  qs.set("sort", q.sort);
  qs.set("dir", q.dir);
  return qs;
}
