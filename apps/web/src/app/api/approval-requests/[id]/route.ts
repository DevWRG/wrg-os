import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /approval-requests/:id (F11). viewer_user_id dari
// sesi → API ikut menghitung apakah akun ini boleh memutus tahap sekarang.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/approval-requests", "view");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(
      `/approval-requests/${encodeURIComponent(id)}?viewer_user_id=${encodeURIComponent(guard.me.id)}`,
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
