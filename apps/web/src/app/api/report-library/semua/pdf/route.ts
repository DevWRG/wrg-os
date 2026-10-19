import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canViewReportLibrary, LAPORAN } from "@/lib/report-library";

export const dynamic = "force-dynamic";

// F92 — semua laporan dalam SATU PDF. Daftar laporan ditentukan DI SINI dari izin menu
// sumber tiap laporan (bukan dari query browser), jadi user hanya mendapat bagian yang
// memang boleh ia lihat di halamannya.
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewReportLibrary(me)) return Response.json({ error: "forbidden — tak punya izin menu Report Library" }, { status: 403 });
  const keys = LAPORAN.filter((l) => featureAllowed(me, l.menu, "view")).map((l) => l.key);
  if (keys.length === 0) return Response.json({ error: "tak ada laporan yang boleh dibuka" }, { status: 403 });
  try {
    const oleh = encodeURIComponent(me.name || me.email || "");
    const res = await gatewayFetch(`/report-library/semua/pdf?keys=${keys.join(",")}&oleh=${oleh}`, { headers: { "x-user-id": me.id } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "gagal membuat PDF" }));
      return Response.json(data, { status: res.status });
    }
    // Biner apa adanya — jangan lewat relay() (JSON.parse merusak file).
    return new Response(res.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="report-library.pdf"',
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
