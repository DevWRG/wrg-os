import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F32 — daftar & unggah bukti pembayaran. gatewayFetch menyuntik x-service-token yang
// mem-bypass JWT di apps/api, jadi izin WAJIB diperiksa di sini (menyembunyikan tombol
// di UI tidak menutup endpoint). Lihat = 'view'; unggah = 'create'.
export async function GET(req: Request) {
  const g = await requireFeature("/bukti-pembayaran", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  // Hanya parameter yang dikenal yang diteruskan, dipotong panjangnya.
  const qs = new URLSearchParams();
  for (const k of ["kode", "q"]) {
    const v = src.get(k);
    if (v) qs.set(k, v.slice(0, 120));
  }
  for (const k of ["limit", "offset"]) {
    const v = Number(src.get(k));
    if (Number.isInteger(v) && v >= 0) qs.set(k, String(v));
  }
  try {
    return relay(await gatewayFetch(`/bukti-pembayaran${qs.size ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// FormData dibangun ulang (jangan teruskan content-type asli — boundary-nya milik body
// lama); `oleh` dari SESI, input browser diabaikan.
export async function POST(req: Request) {
  const g = await requireFeature("/bukti-pembayaran", "create");
  if (!g.ok) return g.res;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file wajib diisi", field: "file" }, { status: 400 });
  const fd = new FormData();
  fd.set("file", file, file.name);
  fd.set("kode", String(form.get("kode") ?? ""));
  fd.set("catatan", String(form.get("catatan") ?? ""));
  fd.set("oleh", g.me.name?.trim() || g.me.email || g.me.id);
  try {
    return relay(await gatewayFetch("/bukti-pembayaran", { method: "POST", body: fd }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
