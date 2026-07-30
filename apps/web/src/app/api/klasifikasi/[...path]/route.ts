import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKlasifikasi, canEditKlasifikasi } from "@/lib/klasifikasi-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /klasifikasi/* (klasifikasi produk + kode produk, migrasi 072).
// GET  = user berizin fitur 'klasifikasi-produk'
// POST/DELETE = HoD Business / Purchasing / admin — kode produk menempel permanen
//   di Accurate, jadi hak tulisnya dibatasi jabatan, bukan sekadar izin menu.
async function siap(tulis: boolean) {
  const me = await sessionUser();
  if (!me) return { err: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (!canViewKlasifikasi(me)) return { err: Response.json({ error: "forbidden" }, { status: 403 }) };
  if (tulis && !canEditKlasifikasi(me)) {
    return {
      err: Response.json(
        { error: "forbidden (hanya HoD Business / Purchasing / admin)" }, { status: 403 },
      ),
    };
  }
  return { me };
}

const sub = async (ctx: { params: Promise<{ path: string[] }> }) =>
  ((await ctx.params).path ?? []).join("/");

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await siap(false);
  if (g.err) return g.err;
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/klasifikasi/${await sub(ctx)}${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await siap(true);
  if (g.err) return g.err;
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  // created_by diisi server dari sesi — jangan percaya nilai dari klien.
  const payload = { ...(body as Record<string, unknown>), createdBy: g.me?.email ?? null };
  try {
    return relay(await gatewayFetch(`/klasifikasi/${await sub(ctx)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await siap(true);
  if (g.err) return g.err;
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/klasifikasi/${await sub(ctx)}${qs ? `?${qs}` : ""}`,
      { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
