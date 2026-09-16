import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /cashin/* (F-CASHIN Mitigasi Uang Masuk Harian).
// GET: ringkasan harian, baris mutasi, master rekening, matriks kelengkapan.
// POST /cashin/upload: setor rekening koran (PDF) dari menu web — jalur kedua
// selain WA #KORAN. PATCH: triage kategori baris + koreksi master rekening.
//
// Gate: cukup user login (pola sama /doc-klaim). Siapa yang boleh membuka menu
// ini diatur Direktur lewat matriks Akses Grup dengan feature key "uang-masuk"
// (otomatis dari url menu), bukan gate identitas yang direka di kode.
function joinPath(path: string[] | undefined): string {
  return (path ?? []).join("/");
}

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const sub = joinPath((await ctx.params).path);
  const qs = new URL(req.url).searchParams.toString();
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    return relay(await gatewayFetch(`/cashin${sub ? `/${sub}` : ""}${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = joinPath((await ctx.params).path);
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/cashin${sub ? `/${sub}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = joinPath((await ctx.params).path);
  const body = await req.text();
  try {
    return relay(
      await gatewayFetch(`/cashin${sub ? `/${sub}` : ""}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": me.id },
        body,
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
