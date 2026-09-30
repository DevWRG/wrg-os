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
// Dua bentuk badan yang diterima:
//   { employee_id, posisi_id }        → satu tautan, balasannya diteruskan apa adanya
//   { items: [{employee_id, posisi_id}, …] } → banyak tautan sekaligus
//
// Bentuk `items` ada karena 16 dari 22 karyawan tak terpetakan ada di SATU dept
// akibat satu cacat kapasitas di form: itu satu keputusan orang, bukan 16. Yang
// dikirim tetap 16 panggilan ke apps/api (setTautanManual idempoten, ON CONFLICT
// DO UPDATE) — batch di sini soal jumlah klik dan jumlah ronde jaringan, bukan
// transaksi tunggal. Konsekuensinya gagal sebagian MUNGKIN, jadi hasil per-item
// dikembalikan apa adanya; menelannya jadi satu "ok" akan membuat orang mengira
// semuanya tersimpan.
const BATAS_ITEM = 200;

export async function POST(req: Request) {
  const gate = await requireRaciEdit();
  if (!gate.ok) return gate.res;
  const oleh = gate.me.email ?? gate.me.id;

  let body: { employee_id?: string; posisi_id?: number; items?: { employee_id?: string; posisi_id?: number }[] } = {};
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }

  const kirim = (employeeId: string, posisiId: number) =>
    gatewayFetch("/picform/tautan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        employee_id: employeeId,
        posisi_id: posisiId,
        // dari sesi, bukan dari klien
        oleh,
      }),
    });

  if (Array.isArray(body.items)) {
    const items = body.items;
    if (items.length === 0) return Response.json({ error: "items kosong" }, { status: 400 });
    if (items.length > BATAS_ITEM) return Response.json({ error: `maksimal ${BATAS_ITEM} item per permintaan` }, { status: 400 });
    if (items.some((i) => !i.employee_id || !i.posisi_id)) {
      return Response.json({ error: "tiap item wajib punya employee_id + posisi_id" }, { status: 400 });
    }

    try {
      // Berurutan, bukan Promise.all: semuanya menulis ke tabel yang sama dan
      // tiap balasan membawa hitungan keterisian posisi — dijalankan paralel,
      // angka `terpakai` yang dilaporkan jadi tergantung siapa yang menang.
      const hasil: { employee_id: string; ok: boolean; error?: string; melebihi?: unknown }[] = [];
      for (const it of items) {
        const res = await kirim(it.employee_id!, Number(it.posisi_id));
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; melebihi?: unknown };
        hasil.push({
          employee_id: it.employee_id!,
          ok: res.ok && !j.error,
          error: j.error ?? (res.ok ? undefined : `HTTP ${res.status}`),
          melebihi: j.melebihi,
        });
      }
      return Response.json({ ok: hasil.every((h) => h.ok), hasil });
    } catch {
      return Response.json({ error: "backend unreachable" }, { status: 502 });
    }
  }

  if (!body.employee_id || !body.posisi_id) {
    return Response.json({ error: "employee_id + posisi_id wajib" }, { status: 400 });
  }

  try {
    return relay(await kirim(body.employee_id, Number(body.posisi_id)));
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
