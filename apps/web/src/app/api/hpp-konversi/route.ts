import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditHppKonversi, canViewHppKonversi } from "@/lib/hpp-konversi-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /hpp-konversi (migrasi 309, tab "Konversi satuan HPP" di Setup Harga).
// Isinya HPP → gate WAJIB di sini (apps/api tidak menggate; service token melewati JWT):
//   GET    → canViewHppKonversi  (Setup Harga + Finance, atau izin matriks view)
//   PUT    → canEditHppKonversi  (simpan konversi satu item)
//   DELETE → canEditHppKonversi  (?item_id=… → item kembali memakai HPP kemasan)
// Jejak penyetel (`oleh`) diambil dari SESI, bukan dari body browser.

const pelaku = (me: { name?: string; email?: string }): string | null => me.name || me.email || null;

export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewHppKonversi(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["hari", "limit"]) {
    const v = src.get(k);
    if (v && /^\d{1,4}$/.test(v)) qs.set(k, v);
  }
  try {
    return relay(await gatewayFetch(`/hpp-konversi${qs.size ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditHppKonversi(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "invalid JSON body" }, { status: 400 });
  try {
    return relay(await gatewayFetch("/hpp-konversi", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item_id: body.item_id,
        isi_per_kemasan: body.isi_per_kemasan ?? null,
        hpp_per_satuan: body.hpp_per_satuan ?? null,
        catatan: body.catatan ?? null,
        oleh: pelaku(me),
      }),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditHppKonversi(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("item_id") ?? "";
  // Divalidasi ketat sebelum masuk path gateway (pola safeSubpath / P10).
  if (!/^\d{1,19}$/.test(id)) return Response.json({ error: "item_id tidak valid" }, { status: 400 });
  const oleh = encodeURIComponent(pelaku(me) ?? "");
  try {
    return relay(await gatewayFetch(`/hpp-konversi/${id}?oleh=${oleh}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
