import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /media?p=<path> — stream balik file foto (binary).
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("p");
  if (!p) return Response.json({ error: "param p wajib" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/media?p=${encodeURIComponent(p)}`);
    if (!res.ok) return Response.json({ error: "media tak tersedia" }, { status: res.status });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
