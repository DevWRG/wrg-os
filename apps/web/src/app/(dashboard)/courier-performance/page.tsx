import { redirect } from "next/navigation";

// Kurir Performance kini tab "Kinerja Kurir" di menu Tracking Pengiriman (K4,
// evaluasi menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya
// tautan yang sudah beredar tidak 404. Path ini tetap dimiliki entri features
// `courier-performance` (findNavItem), jadi gerbang izinnya sama seperti dulu.
export default function CourierPerformanceRedirect(): never {
  redirect("/shipment-tracking?tab=kurir");
}
