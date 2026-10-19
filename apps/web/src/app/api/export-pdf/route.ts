import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F92 — tombol "Export PDF" di dashboard. Gerbangnya cukup SESI: isi PDF adalah
// baris yang sudah ada di layar peminta (dikirim dari browser), jadi endpoint ini
// tak membuka data apa pun yang belum bisa dilihat user itu.
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.text();
  try {
    // Nama pencetak dari SESI, bukan dari browser.
    const oleh = encodeURIComponent(me.name || me.email || "");
    const res = await gatewayFetch(`/export/pdf?oleh=${oleh}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "gagal membuat PDF" }));
      return Response.json(data, { status: res.status });
    }
    // Biner apa adanya — jangan lewat relay() (JSON.parse merusak file).
    return new Response(res.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="laporan.pdf"',
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
