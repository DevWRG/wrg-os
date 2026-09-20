import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewInsentifTim } from "@/lib/insentif-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /insentif/*.
//
// ⚠️ HEADER x-user-id WAJIB DITERUSKAN. Seluruh aturan akses F67 (PRD §E) berdiri di
// atas header ini: tanpa x-user-id, backend memperlakukan pemanggil sebagai TIDAK
// DIKENAL dan menolak (fail-closed) — jadi kalau header ini hilang, menunya bukan
// "bocor" melainkan mati total. Sebaliknya, catch-all BFF yang LUPA meneruskannya
// pernah bikin scope backend mustahil jalan sama sekali (tab Pacing PR #673, Sales
// Calendar PR #675). Jangan salin route ini tanpa barisnya.
//
// POST /insentif/compute sengaja TIDAK dilayani di sini: itu operasi ops yang butuh
// service token, bukan sesuatu yang dipanggil dari browser.
async function proxy(req: Request, path: string[], method: string, body?: string) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const sub = (path ?? []).join("/");
  if (sub === "compute") {
    return Response.json({ error: "not available via web" }, { status: 404 });
  }

  // Gerbang TULIS. x-service-token yang disuntik gatewayFetch mem-bypass JWT di apps/api,
  // jadi route BFF yang meneruskan POST tanpa cek izin bisa dipanggil siapa pun yang
  // sudah login ([[wrg-os-gerbang-tulis-bff]]). Pagar barisnya tetap di server
  // (setLeadType / actApproval), yang di sini cuma pagar kasar "boleh menulis apa".
  //
  // Dua jenis tulisan dengan pemilik berbeda:
  //   • /<amId>/lead      → penandaan tipe lead, wewenang menu tim.
  //   • /<amId>/approval  → rantai persetujuan. Langkah PERTAMA (pengajuan) milik AM
  //     yang bersangkutan, yang justru TIDAK berhak membuka menu tim. Kalau gerbangnya
  //     disamakan, tombol "Ajukan" di menu Insentif Saya tertolak 403 sebelum sampai ke
  //     server — dan rantainya tak pernah bisa dimulai.
  if (method !== "GET") {
    const [amId, aksi] = path ?? [];
    const dirinya = aksi === "approval" && !!me.am_id && me.am_id === amId;
    if (!dirinya && !canViewInsentifTim(me)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  try {
    const res = await gatewayFetch(`/insentif/${sub}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        "x-user-id": me.id,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}

// POST dipakai penandaan tipe lead: /api/insentif/<amId>/lead.
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const body = await req.text();
  return proxy(req, (await ctx.params).path, "POST", body);
}
