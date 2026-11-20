import { redirect } from "next/navigation";

// Spider Network kini tab "Peta Koordinasi" di menu SOP & Peta Koordinasi (K14,
// evaluasi menu 19 Nov 2026). Rute lama dipertahankan sebagai redirect supaya tautan
// yang sudah beredar tidak 404. Path ini tetap dimiliki entri features `network`
// (findNavItem), dan /api/network/graph (graf entitas A9, dicadangkan) tetap
// requireFeature("/network").
export default function NetworkRedirect(): never {
  redirect("/sop-otomasi?tab=koordinasi");
}
