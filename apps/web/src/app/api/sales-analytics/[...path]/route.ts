import { gatewayFetch } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { salesAnalyticsMenus } from "@/lib/sales-analytics-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /sales-analytics/*. Meneruskan identitas user via header
// x-user-id agar backend menerapkan row-level scope (AM → data sendiri) dan
// scoping saved-views/alert per user. path catch-all.
//
// Gerbang menu WAJIB di sini (requireFeature), bukan cuma login: gatewayFetch
// menyuntik x-service-token yang mem-bypass JWT di apps/api, dan pengguna yang
// bukan AM/HoD mendapat scope PENUH di backend. Dulu route ini hanya mengecek
// sesi → siapa pun yang login (mis. staf GA tanpa menu Sales Analytics) bisa
// memanggil /api/sales-analytics/* langsung dan melihat revenue seluruh
// perusahaan. Ketahuan saat menambah tab E-Catalog (F72), 13 Okt 2026.
//
// Peta sub-path → menu ada di lib/sales-analytics-access (alert = Sales Alerts
// saja; evaluate = admin).

async function proxy(req: Request, path: string[], method: string) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = safeSubpath(path);
  if (sub === null) return badSubpath();
  const menus = salesAnalyticsMenus(sub);
  const boleh = menus ? menus.some((m) => featureAllowed(me, m, "view")) : me.role === "admin" || me.superuser === true;
  if (!boleh) return Response.json({ error: "forbidden — tak punya izin untuk menu ini" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const headers: Record<string, string> = { "x-user-id": me.id };
  let body: string | undefined;
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    headers["content-type"] = "application/json";
    body = await req.text();
  }
  try {
    const res = await gatewayFetch(`/sales-analytics/${sub}${qs ? `?${qs}` : ""}`, { method, headers, body });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "POST");
}
export async function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "PATCH");
}
export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "DELETE");
}
