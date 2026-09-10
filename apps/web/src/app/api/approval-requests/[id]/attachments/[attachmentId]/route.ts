import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /approval-requests/:id/attachments/:attachmentId
// (F11). Respons BINER (PDF/PNG), bukan JSON — jangan lewat relay().
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  try {
    const res = await gatewayFetch(`/approval-requests/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `backend ${res.status}` }));
      return Response.json(data, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "inline",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
