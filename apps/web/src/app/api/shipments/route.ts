import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/shipments (mirror surat jalan Accurate).
// Dipakai F22 (Instalasi Alat) utk sumber pilihan No. SJ di langkah SJ —
// exception domain CRM/Accurate DISETUJUI khusus utk kebutuhan ini (lihat
// apps/web/src/components/crm/installation-row-actions.tsx).
export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get("limit") || "200";
  try {
    const res = await gatewayFetch(`/accurate/shipments?limit=${encodeURIComponent(limit)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
