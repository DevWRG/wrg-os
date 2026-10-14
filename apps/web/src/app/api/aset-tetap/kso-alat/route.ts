import { teruskanGet } from "../_gerbang";

export const dynamic = "force-dynamic";

// Cari alat KSO (SN / nama alat / faskes) untuk penautan manual.
export function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return teruskanGet(`/aset-tetap/kso-alat?q=${encodeURIComponent(q.slice(0, 80))}`);
}
