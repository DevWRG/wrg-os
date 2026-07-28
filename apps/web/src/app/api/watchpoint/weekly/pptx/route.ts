import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /watchpoint/weekly/pptx. Respons BINER (deck .pptx),
// jadi tidak lewat relay() (relay memaksa JSON). Header content-disposition
// diteruskan apa adanya supaya nama file deck tetap dari backend.
export async function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["year", "week", "hod"]) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }
  const q = qs.toString();

  try {
    const res = await gatewayFetch(`/watchpoint/weekly/pptx${q ? `?${q}` : ""}`);
    if (!res.ok) {
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : { error: `backend ${res.status}` };
      } catch {
        body = { error: text.slice(0, 300) || `backend ${res.status}` };
      }
      return Response.json(body, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type":
          res.headers.get("content-type") ??
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="watchpoint-weekly.pptx"',
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
