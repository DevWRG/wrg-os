import { redirect } from "next/navigation";

// Sales Alerts kini tab "Aturan Alert" di Sales Analytics (K12, evaluasi menu 19 Nov
// 2026). Rute lama dipertahankan sebagai redirect supaya tautan yang sudah beredar
// tidak 404. Path ini tetap dimiliki entri features `sales-alerts` (findNavItem).
export default function SalesAlertsRedirect(): never {
  redirect("/sales-analytics?view=alerts");
}
