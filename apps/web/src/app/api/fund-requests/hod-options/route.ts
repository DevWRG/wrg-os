import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F138 — daftar HOD aktif utk dropdown pilih Tier-1 approver saat submit.
// Login wajib (bukan HOD-only) — semua Karyawan yang mengajukan perlu bisa
// memuat daftar ini.
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const res = await gatewayFetch("/fund-requests/hod-options");
  return relay(res);
}
