import { redirect } from "next/navigation";

// Inventory kini tab "Stok" di menu Katalog & Stok (Accurate) (K2, evaluasi menu
// 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya tautan yang sudah
// beredar tidak 404. Path ini tetap dimiliki entri features `inventory` (findNavItem).
export default function InventoryRedirect(): never {
  redirect("/products?tab=stok");
}
