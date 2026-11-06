import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { scopeMedia } from "@/lib/media-scope";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /media?p=<path> — stream balik file foto (binary).
// Izin: root yang boleh dibuka mengikuti izin lihat menu (lib/media-scope.ts) dan
// dikirim ke API lewat header x-media-scope; API menolak path di luar root itu.
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = scopeMedia(me);
  if (!scope.length) return Response.json({ error: "forbidden — tak punya izin membuka berkas ini" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return Response.json({ error: "param p wajib" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/media?p=${encodeURIComponent(p)}`, { headers: { "x-media-scope": scope.join(",") } });
    if (!res.ok) return Response.json({ error: "media tak tersedia" }, { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
