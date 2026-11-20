import { redirect } from "next/navigation";

// Inbound Receiving kini tab "Checklist Penerimaan" di menu PO & Penerimaan Barang
// (K3, evaluasi menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya
// tautan & bookmark yang sudah beredar tidak 404. Gerbang izin tetap berlaku: path
// ini dimiliki entri features `inbound-receiving` (findNavItem), dan tujuan
// merender tab hanya bila tabVisible.
export default async function InboundReceivingRedirect({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<never> {
  const q = ((await searchParams).q ?? "").trim();
  redirect(`/purchase-orders?tab=penerimaan${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}
