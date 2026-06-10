import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /webhooks/wa (webhook gateway WA openclaw →
// wa_message). Meneruskan header secret bila ada.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = req.headers.get("x-wa-secret");
  if (secret) headers["x-wa-secret"] = secret;
  try {
    const res = await gatewayFetch("/webhooks/wa", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
