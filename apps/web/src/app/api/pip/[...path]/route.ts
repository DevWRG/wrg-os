// Gateway → apps/api /pip/* dan /improvement/* (F70 PIP 90-Day Tracker + Improvement).
//
// Izin = fitur menu 'karyawan' (Raport Karyawan 360), BUKAN aturan baru: lihat = view, tambah data
// = create, ubah/putuskan = edit (hanya dibatasi bila matriks Akses Grup punya baris 'karyawan';
// belum diatur = ikut gerbang lihat, lihat featureAllowed). Scope baris ditegakkan apps/api dari
// x-user-id; pelaku `oleh` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import type { Action } from "@/lib/perms";

export const dynamic = "force-dynamic";

const ID = "\\d{1,15}";
// Daftar putih sub-route yang memang dimiliki fitur ini → path apps/api + aksi izin.
const ROUTES: { re: RegExp; method: "GET" | "POST" | "PATCH"; aksi: Action; api: (sub: string) => string }[] = [
  { re: /^improvement(\/[A-Za-z0-9_.-]+)?$/, method: "GET", aksi: "view", api: (s) => `/${s}` },
  { re: /^cases$/, method: "GET", aksi: "view", api: (s) => `/pip/${s}` },
  { re: new RegExp(`^cases/${ID}$`), method: "GET", aksi: "view", api: (s) => `/pip/${s}` },
  { re: /^cases$/, method: "POST", aksi: "create", api: (s) => `/pip/${s}` },
  { re: new RegExp(`^cases/${ID}/(goals|milestones|checkins)$`), method: "POST", aksi: "create", api: (s) => `/pip/${s}` },
  { re: new RegExp(`^cases/${ID}/outcome$`), method: "POST", aksi: "edit", api: (s) => `/pip/${s}` },
  { re: new RegExp(`^milestones/${ID}$`), method: "PATCH", aksi: "edit", api: (s) => `/pip/${s}` },
];

async function teruskan(req: Request, ctx: { params: Promise<{ path: string[] }> }, method: "GET" | "POST" | "PATCH"): Promise<Response> {
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null || sub === "") return badSubpath();
  const rute = ROUTES.find((r) => r.method === method && r.re.test(sub));
  if (!rute) return Response.json({ error: "tidak ditemukan" }, { status: 404 });
  const g = await requireFeature("/karyawan", rute.aksi);
  if (!g.ok) return g.res;
  const headers: Record<string, string> = { "x-user-id": g.me.id };
  let body: string | undefined;
  if (method !== "GET") {
    let isi: Record<string, unknown> = {};
    try {
      const t = await req.text();
      isi = t ? (JSON.parse(t) as Record<string, unknown>) : {};
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!isi || typeof isi !== "object" || Array.isArray(isi)) return Response.json({ error: "body bukan JSON object yang sah" }, { status: 400 });
    headers["content-type"] = "application/json";
    body = JSON.stringify({ ...isi, oleh: actorName(g.me) });
  }
  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`${rute.api(sub)}${qs ? `?${qs}` : ""}`, { method, headers, body }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export const GET = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => teruskan(req, ctx, "GET");
export const POST = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => teruskan(req, ctx, "POST");
export const PATCH = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => teruskan(req, ctx, "PATCH");
