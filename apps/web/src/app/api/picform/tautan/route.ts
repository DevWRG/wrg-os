import { gatewayFetch, relay } from "@/lib/gateway";
import { requireRaciEdit } from "@/lib/raci-peta-access";

export const dynamic = "force-dynamic";

// Jalur TULIS pemetaan posisi↔karyawan (F157). Rute STATIS ini menang atas
// catch-all /api/picform/[...path] (yang sengaja tetap GET-only), sehingga
// hanya path inilah yang menerima POST/DELETE.
//
// OTORISASI DIKERJAKAN DI SINI, bukan di apps/api. Alasannya sesi login hanya
// terbaca di lapisan web (cookie wrg_session → /auth/me); apps/api dijangkau
// lewat x-service-token yang tidak membawa identitas orang. Karena itu:
//   • requireRaciEdit() memverifikasi izin SEBELUM meneruskan;
//   • `oleh` diambil dari sesi hasil verifikasi, dan body klien TIDAK dipercaya
//     untuk kolom itu — kalau diambil dari body, siapa pun yang lolos gate bisa
//     mengaku sebagai orang lain, dan jejaknya jadi lebih berbahaya daripada
//     tidak ada sama sekali (terlihat resmi, isinya karangan).
//
// Menyembunyikan tombol di UI BUKAN pengamanan; gate ini yang menegakkannya.
export async function POST(req: Request) {
  const gate = await requireRaciEdit();
  if (!gate.ok) return gate.res;

  let body: { employee_id?: string; posisi_id?: number } = {};
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!body.employee_id || !body.posisi_id) {
    return Response.json({ error: "employee_id + posisi_id wajib" }, { status: 400 });
  }

  try {
    const res = await gatewayFetch("/picform/tautan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        employee_id: body.employee_id,
        posisi_id: Number(body.posisi_id),
        // dari sesi, bukan dari klien
        oleh: gate.me.email ?? gate.me.id,
      }),
    });
    return relay(res);
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireRaciEdit();
  if (!gate.ok) return gate.res;

  const u = new URL(req.url);
  const employeeId = u.searchParams.get("employee_id");
  const posisiId = u.searchParams.get("posisi_id");
  if (!employeeId || !posisiId) {
    return Response.json({ error: "employee_id + posisi_id wajib" }, { status: 400 });
  }

  try {
    const res = await gatewayFetch(
      `/picform/tautan?employee_id=${encodeURIComponent(employeeId)}&posisi_id=${encodeURIComponent(posisiId)}`,
      { method: "DELETE" },
    );
    return relay(res);
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
