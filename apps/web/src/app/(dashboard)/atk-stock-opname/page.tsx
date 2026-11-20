import { redirect } from "next/navigation";

// Kini tab "Stock Opname" di menu Kelola ATK (K5 opsi B, evaluasi menu 19 Nov 2026). Rute
// lama dipertahankan sebagai redirect supaya tautan yang sudah beredar tidak 404.
// Path ini tetap dimiliki entri features `atk-stock-opname` (findNavItem), jadi gerbang
// izinnya — termasuk gerbang tulis mutasi per jenis (lib/atk-access) — sama.
export default function Redirect(): never {
  redirect("/atk-master?tab=opname");
}
