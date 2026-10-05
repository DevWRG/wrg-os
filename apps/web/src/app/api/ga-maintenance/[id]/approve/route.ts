import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canApproveGaFinance } from "@/lib/ga-maintenance-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ga-maintenance/:id/approve (F137). approved_by
// SELALU dari sesi login kalau ada (JANGAN percaya nilai dari client kalau
// sesi tersedia — siapa yg approve harus siapa yg sedang login, bukan
// bebas dipilih). Fallback body.approved_by cuma utk dev (AUTH_ENABLED=false,
// belum ada sesi) — picker di UI, lihat ga-maintenance-actions.tsx.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { approved_by?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body opsional
  }
  const me = await sessionUser();
  // Gerbang yang SAMA dgn tombol "Approve Finance" di /ga-aset. Tombol yg
  // disembunyikan tak menutup endpoint: gatewayFetch menyuntik service token
  // yg mem-bypass JWT di apps/api, jadi tanpa cek ini siapa pun yg login bisa
  // meng-approve maintenance >Rp5jt lewat POST langsung.
  if (me) {
    if (!canApproveGaFinance(me)) {
      return Response.json({ error: "forbidden (Approve Finance: admin/Finance/Akses Grup ga-finance-approval)" }, { status: 403 });
    }
  } else if ((process.env.AUTH_ENABLED ?? "").toLowerCase() === "true") {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const approvedBy = me?.id ?? body.approved_by;
  if (!approvedBy) return Response.json({ error: "approved_by wajib diisi (atau login dulu)" }, { status: 400 });
  try {
    return await relay(
      await gatewayFetch(`/ga-maintenance/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved_by: approvedBy }),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
