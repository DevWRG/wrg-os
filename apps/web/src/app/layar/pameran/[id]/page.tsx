import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { LayarPanggung } from "@/components/pameran/layar-panggung";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Layar Panggung — Pameran", robots: { index: false, follow: false } };

// F173 — mode layar panggung: QR besar layar penuh untuk proyektor/LED, jumlah pendaftar live.
// Di LUAR grup (dashboard) supaya tanpa sidebar; karena itu gerbang rute layout dashboard tak
// berlaku di sini → cek izin menu Pameran sendiri dan WAJIB redirect (bukan render kondisional).
export default async function LayarPameranPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) redirect("/login");
  if (!featureAllowed(me, "/pameran", "view")) redirect("/akses-ditolak?menu=Pameran");
  const { id } = await params;
  if (!/^\d+$/.test(id)) redirect("/pameran");
  return <LayarPanggung id={id} />;
}
