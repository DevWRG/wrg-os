import { redirect } from "next/navigation";

// Customers kini tab Revenue/Churn/Win-back di menu Customer & Akun (K9, evaluasi
// menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya tautan yang
// sudah beredar tidak 404. Path ini tetap dimiliki entri features `customers` (findNavItem).
export default function CustomersRedirect(): never {
  redirect("/accounts?tab=revenue");
}
