import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";
import { canEditPricelistSetup, canPublishPricelist, canViewPricelist } from "@/lib/pricelist-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /pricebook/* (F142 Price Book keagenan).
// Tiga tingkat gate, sama dengan yang dipakai halaman:
//   items / published / periode → semua user berizin fitur 'pricebook'
//   summary                     → Direktur/admin/superuser
//   setup*                      → HoD Business / Purchasing / admin
//
// `setup` WAJIB dipisah karena isinya HPP & margin. Sebelumnya seluruh sub-path
// lolos dengan canViewPricebook saja, jadi siapa pun yang boleh membuka Price Book
// bisa memanggil /api/pricebook/setup dan menerima HPP — halamannya memang tak
// pernah memanggil dari browser, tapi gate tak boleh bergantung pada itu.
const perluSetupGate = (sub: string) => sub === "setup" || sub.startsWith("setup/");

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPricebook(me)) return Response.json({ error: "forbidden" }, { status: 403 });

  const sub = ((await ctx.params).path ?? []).join("/");
  if (sub === "summary" && !canViewPricebookSummary(me)) {
    return Response.json({ error: "forbidden (Direktur/admin only)" }, { status: 403 });
  }
  if (perluSetupGate(sub) && !canEditPricelistSetup(me)) {
    return Response.json({ error: "forbidden (HoD Business/Purchasing only)" }, { status: 403 });
  }

  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/pricebook/${sub}${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Setel harga satu baris price book (HPP · Price List · Diskon).
export async function PATCH(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditPricelistSetup(me)) {
    return Response.json({ error: "forbidden (HoD Business/Purchasing only)" }, { status: 403 });
  }
  const sub = ((await ctx.params).path ?? []).join("/");
  if (sub !== "setup") return Response.json({ error: "route tak ada" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  try {
    return relay(await gatewayFetch("/pricebook/setup", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Jejak penyetel diambil dari SESI, bukan dari body — kalau dari body, siapa
      // pun bisa menulis nama orang lain.
      body: JSON.stringify({ ...body, updatedBy: me.email ?? null }),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// POST dipakai dua hal dengan hak yang BERBEDA:
//   published/pdf            → siapa pun yang boleh melihat daftar harga (AM).
//                              Isinya persis yang sudah tampil di layarnya.
//   setup/publish|unpublish  → butuh hak publish, bukan cuma edit.
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = ((await ctx.params).path ?? []).join("/");

  if (sub === "published/pdf") {
    if (!canViewPricelist(me)) return Response.json({ error: "forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    try {
      const res = await gatewayFetch("/pricebook/published/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Nama pencetak diisi server dari sesi — footer dokumen tidak boleh bisa
        // diisi sembarang nama dari browser.
        body: JSON.stringify({ ...body, oleh: me.name || me.email }),
      });
      if (!res.ok) return relay(res);
      // Diteruskan sebagai biner apa adanya; relay() akan mencoba JSON.parse dan
      // merusak file.
      return new Response(res.body, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="daftar-harga-keagenan.pdf"',
        },
      });
    } catch {
      return Response.json({ error: "backend unreachable" }, { status: 502 });
    }
  }

  if (sub !== "setup/publish" && sub !== "setup/unpublish") {
    return Response.json({ error: "route tak ada" }, { status: 404 });
  }
  if (!canEditPricelistSetup(me) || !canPublishPricelist(me)) {
    return Response.json({ error: "forbidden (butuh hak publish pricelist)" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  try {
    return relay(await gatewayFetch(`/pricebook/${sub}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, by: me.email ?? null }),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
