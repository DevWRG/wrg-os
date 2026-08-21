import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /it-tickets (F52, OPS).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  try {
    return await relay(await gatewayFetch(`/it-tickets${qs}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch(`/it-tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
