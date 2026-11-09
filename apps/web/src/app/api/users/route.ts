import { featureAllowed, requireFeature } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /master/users (roster karyawan).
// Gerbang di sini, bukan di apps/api: gatewayFetch menyuntik x-service-token yang
// mem-bypass JWT, jadi tanpa cek ini siapa pun yang login (termasuk viewer) bisa
// membaca nomor WA seluruh roster dan meng-upsert baris roster lewat curl.

// Baca: menu Users, atau Manage Leave (form cuti memilih karyawan dari roster).
const MENU_BACA = ["/users", "/leave"] as const;

export async function GET(req: Request) {
  const g = await requireFeature(MENU_BACA);
  if (!g.ok) return g.res;
  const search = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/master/users${search}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Tulis: POST /master/users itu UPSERT per am_id — satu panggilan bisa menambah
// baris baru ATAU menimpa baris yang ada (termasuk role & nomor WA), jadi wajib
// izin create DAN edit di menu Users.
export async function POST(req: Request) {
  const g = await requireFeature("/users", "create");
  if (!g.ok) return g.res;
  if (!featureAllowed(g.me, "/users", "edit")) {
    return Response.json({ error: "forbidden — tak punya izin edit untuk menu ini" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/master/users", {
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
