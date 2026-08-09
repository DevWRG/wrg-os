import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /insentif/*.
//
// ⚠️ HEADER x-user-id WAJIB DITERUSKAN. Seluruh aturan akses F67 (PRD §E) berdiri di
// atas header ini: tanpa x-user-id, backend memperlakukan pemanggil sebagai TIDAK
// DIKENAL dan menolak (fail-closed) — jadi kalau header ini hilang, menunya bukan
// "bocor" melainkan mati total. Sebaliknya, catch-all BFF yang LUPA meneruskannya
// pernah bikin scope backend mustahil jalan sama sekali (tab Pacing PR #673, Sales
// Calendar PR #675). Jangan salin route ini tanpa barisnya.
//
// POST /insentif/compute sengaja TIDAK dilayani di sini: itu operasi ops yang butuh
// service token, bukan sesuatu yang dipanggil dari browser.
async function proxy(req: Request, path: string[], method: string) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const sub = (path ?? []).join("/");
  if (sub === "compute") {
    return Response.json({ error: "not available via web" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  try {
    const res = await gatewayFetch(`/insentif/${sub}${qs ? `?${qs}` : ""}`, {
      method,
      headers: { "x-user-id": me.id },
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}
