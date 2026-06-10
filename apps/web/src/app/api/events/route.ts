import type { EventEnvelope } from "@wrg/types";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Teruskan EventEnvelope ke backend domain (apps/api) yang memvalidasi & memproses.
// Validasi penuh ada di backend (isEventEnvelope); gateway hanya meneruskan.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const res = await gatewayFetch("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body as EventEnvelope),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
