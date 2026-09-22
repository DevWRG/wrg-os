import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F60 — approve/reject tahap current. Gate identitas & keanggotaan grup DI
// SINI (layer WEB, pola sama fund-requests/[id]/approvals/route.ts): admin/
// superuser selalu lolos (anti-lockout); selain itu WAJIB anggota
// access_group tahap current (dari me.groups, /auth/me — sudah live per
// request, tak perlu panggilan tambahan). apps/api tetap menegakkan ulang
// keanggotaan ini secara live (defense-in-depth, lihat decideStep di
// audit-finding.ts) — dua lapis sengaja, bukan duplikasi percuma: BFF
// menjaga UX (403 jelas sebelum submit), API menjaga kebenaran data.
export async function POST(req: Request, ctx: { params: Promise<{ requestId: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { requestId } = await ctx.params;
  let body: { action?: "approve" | "reject"; note?: string | null };
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
  const detail = await detailRes.json();
  const currentStep = (detail.steps as { urutan: number; accessGroupId: number | null }[] | undefined)?.find(
    (s) => s.urutan === detail.currentUrutan,
  );
  const isAdmin = me.role === "admin" || me.superuser === true;
  const isMember = !!currentStep?.accessGroupId && (me.groups ?? []).some((g) => g.id === currentStep.accessGroupId);
  if (!isAdmin && !isMember) {
    return Response.json({ error: "forbidden — bukan anggota grup yang berwenang untuk tahap ini" }, { status: 403 });
  }

  return relay(
    await gatewayFetch(`/audit-findings/approval-requests/${encodeURIComponent(requestId)}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: body.action, decider_user_id: me.id, note: body.note ?? undefined }),
    }),
  );
}
