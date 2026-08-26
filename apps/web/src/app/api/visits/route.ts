import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /visits. Dipakai tombol Export di tabel /visits:
// tabelnya per-halaman, tapi export harus mengambil SELURUH baris yang cocok
// filter, jadi ia memanggil endpoint ini dari browser dengan limit besar.
//
// x-user-id WAJIB diteruskan dari sesi — bukan dari query string. Tanpa itu
// backend jatuh ke FULL_SCOPE dan seorang AM bisa mengekspor kunjungan seluruh
// perusahaan lewat URL, padahal tabelnya sendiri sudah ter-scope.
export async function GET(req: Request) {
  const qs = new URL(req.url).searchParams;
  qs.delete("x-user-id");
  const me = await sessionUser();
  try {
    const res = await gatewayFetch(
      `/visits${qs.toString() ? `?${qs.toString()}` : ""}`,
      me ? { headers: { "x-user-id": me.id } } : undefined,
    );
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Gateway → apps/api POST /visits (catat kunjungan geotag+foto).
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
