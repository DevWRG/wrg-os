import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { HalamanUndian } from "@/components/pameran/halaman-undian";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Undian Doorprize — Pameran", robots: { index: false, follow: false } };

// F173 — halaman undian tersendiri (layar operator/panggung, tanpa sidebar). Di LUAR grup
// (dashboard) → gerbang rute layout tak berlaku: cek izin menu Pameran sendiri + WAJIB redirect.
// Kocok & tandai hangus butuh izin ubah (dicek lagi di BFF); tanpa itu halaman baca-saja.
export default async function UndianPameranPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) redirect("/login");
  if (!featureAllowed(me, "/pameran", "view")) redirect("/akses-ditolak?menu=Pameran");
  const { id } = await params;
  if (!/^\d+$/.test(id)) redirect("/pameran");
  return <HalamanUndian id={id} bolehKocok={featureAllowed(me, "/pameran", "edit")} />;
}
