import { teruskanGet } from "./_gerbang";

export const dynamic = "force-dynamic";

// Hanya parameter yang dikenal yang diteruskan (bukan query mentah).
const PARAM = ["q", "prefix", "tipe", "status", "sort", "dir", "limit", "offset"] as const;

export function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of PARAM) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return teruskanGet(`/aset-tetap${s ? `?${s}` : ""}`);
}
