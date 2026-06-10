import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway health: cek dirinya + reachability backend domain (apps/api).
export async function GET() {
  try {
    const res = await gatewayFetch("/health");
    const backend = await res.json();
    return Response.json({ status: "ok", gateway: "wrg-web", backend });
  } catch {
    return Response.json(
      { status: "degraded", gateway: "wrg-web", backend: null, error: "backend unreachable" },
      { status: 502 },
    );
  }
}
