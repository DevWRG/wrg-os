import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /accurate/shipments (mirror surat jalan Accurate).
// Dipakai sebagai sumber pilihan No. SJ oleh F22 (Instalasi Alat, langkah SJ)
// dan F12 (Tracking Pengiriman Digital, saat buat tracking baru) — dua PR
// membuat file ini terpisah dengan isi identik. Exception domain CRM/Accurate
// DISETUJUI khusus utk kebutuhan ini.
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
