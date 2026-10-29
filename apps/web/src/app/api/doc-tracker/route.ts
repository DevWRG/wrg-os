import { teruskan } from "./_gerbang";

export const dynamic = "force-dynamic";

// DOC — daftar transaksi + funnel 9 state. Hanya parameter yang dikenal yang diteruskan;
// nilainya divalidasi apps/api (400 bila salah).
export async function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["hari", "state", "q", "billing", "dikirim_belum_dibayar"]) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }
  return teruskan(null, `/doc-tracker${qs.size ? `?${qs}` : ""}`, "GET", "view");
}
