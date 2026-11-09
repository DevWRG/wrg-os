import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /sph/:id/penanda-tangan (F15). GET = daftar pilihan
// (lihat Sales Docs); PUT = ganti penanda tangan saat hod_review/approved
// (edit Sales Docs; pembuat SPH ditolak apps/api). Nama penanda tangan selalu
// dari app_user pilihan, bukan teks bebas — yang boleh diketik hanya jabatan.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    return relay(
      await gatewayFetch(`/sph/${encodeURIComponent(id)}/penanda-tangan`, { headers: { "x-user-id": g.me.id } }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(
      await gatewayFetch(`/sph/${encodeURIComponent(id)}/penanda-tangan`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": g.me.id },
        body: JSON.stringify(bodyDenganPelaku(body, null, "")),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
