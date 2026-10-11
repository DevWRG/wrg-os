import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { auditDecideBlockReason, type DecideCheckRequest } from "@/lib/audit-finding-access";

export const dynamic = "force-dynamic";

// F60 — approve/reject tahap current. Gate identitas, keanggotaan grup, dan
// pemisahan tugas DI SINI (auditDecideBlockReason, dari me.groups /auth/me —
// live per request). Tanpa jalan pintas admin: API selalu mewajibkan
// keanggotaan grup, jadi bypass di sini cuma memindahkan penolakan ke 400. apps/api tetap menegakkan ulang
// keanggotaan ini secara live (defense-in-depth, lihat decideStep di
// audit-finding.ts) — dua lapis sengaja, bukan duplikasi percuma: BFF
// menjaga UX (403 jelas sebelum submit), API menjaga kebenaran data.
export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { requestId } = await ctx.params;
  let body: { action?: "approve" | "reject"; note?: string | null; urutan?: number | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.action !== "approve" && body.action !== "reject") {
    return Response.json({ error: "action wajib (approve/reject)" }, { status: 400 });
  }

  const detailRes = await gatewayFetch(`/audit-findings/approval-requests/${encodeURIComponent(requestId)}`);
  if (!detailRes.ok) return relay(detailRes);
  const detail = (await detailRes.json()) as DecideCheckRequest;
  if (body.urutan != null && Number(body.urutan) !== detail.currentUrutan) {
    return Response.json(
      { error: `tahap sudah berubah (sekarang tahap ${detail.currentUrutan}) — muat ulang lalu putuskan lagi` },
      { status: 409 },
    );
  }
  const blocked = auditDecideBlockReason(me, detail);
  if (blocked) return Response.json({ error: `forbidden — ${blocked}` }, { status: 403 });

  return relay(
    await gatewayFetch(`/audit-findings/approval-requests/${encodeURIComponent(requestId)}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: body.action, decider_user_id: me.id, note: body.note ?? undefined, urutan: body.urutan ?? undefined }),
    }),
  );
}
