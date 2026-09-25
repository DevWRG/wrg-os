import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F44 Document Print Spec Standardizer — gateway → apps/api /print-specs.
// Role min Karyawan (semua login boleh mendefinisikan & lihat standar cetak).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/print-specs${qs}`);
  return relay(res);
}

// created_by diisi dari sesi login (bukan body client) — pola sama created_by F43.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const me = await sessionUser();
  const res = await gatewayFetch("/print-specs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, created_by: me?.name ?? me?.email ?? null }),
  });
  return relay(res);
}
