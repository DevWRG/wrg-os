import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F138 Operational Fund Request — gateway → apps/api /fund-requests.
// Role min Karyawan (semua role login boleh mengajukan & lihat daftar).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/fund-requests${qs}`);
  return relay(res);
}

// requester_name/requester_email WAJIB dari sesi login (bukan body client) —
// beda dari created_by PO (opsional, PO boleh dicatat tanpa identitas ketat).
// Di sini identitas pengaju menentukan siapa yang boleh cancel & jadi dasar
// audit approval, jadi login wajib.
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/fund-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, requester_name: me.name ?? me.email, requester_email: me.email }),
  });
  return relay(res);
}
