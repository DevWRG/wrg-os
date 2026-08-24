import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /kso/produktivitas/export.xlsx. Respons BINER (workbook),
// jadi tidak lewat relay() yang memaksa JSON — pola sama dengan route deck PPTX
// WatchPoint. Header content-disposition diteruskan apa adanya supaya nama berkas
// tetap ditentukan backend (memuat skema + rentang periode).
//
// Rutenya di bawah /api/kso/ supaya ikut gate canViewKso yang sudah ada.
export async function GET(req: Request) {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["skema", "dari", "sampai"]) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }

  try {
    const res = await gatewayFetch(`/kso/produktivitas/export.xlsx?${qs.toString()}`);
    if (!res.ok) {
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : { error: `backend ${res.status}` };
      } catch {
        body = { error: text.slice(0, 300) || `backend ${res.status}` };
      }
      return Response.json(body, { status: res.status });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type":
          res.headers.get("content-type") ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          res.headers.get("content-disposition") ?? 'attachment; filename="kso-produktivitas.xlsx"',
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "gateway gagal" }, { status: 502 });
  }
}
