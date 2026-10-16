// F170 Komite KSO — hak akses layar (Tahap 4).
//
// Satu menu, satu tab per peran, dan tiap tab = satu fitur di matriks Akses Grup (keputusan
// 16 Okt: Komite/Direksi/Admin Sales/Teknik diatur di Akses Grup). Peta yang SAMA ada di
// apps/api/src/repo/kso-komite.ts (TAB_KSO + putuskanIzin) — API memeriksa ulang setiap
// permintaan dan menjadi penentu; helper ini hanya untuk menampilkan menu & tab.
// Gate lama (dipakai hanya sebelum fitur diatur di matriks) sengaja sempit: AM → Rencana Saya,
// HOD → tab HOD, Direktur → Putusan Direksi. Tab lain default TERTUTUP.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export type TabKso = "saya" | "hod" | "agenda" | "direksi" | "penawaran" | "teknik" | "kpi";

export const TAB_KSO: { tab: TabKso; fitur: string; label: string; nama: string }[] = [
  { tab: "saya", fitur: "kso-komite", label: "Rencana Saya", nama: "Komite KSO — Rencana Saya (AM, baca saja)" },
  { tab: "hod", fitur: "kso-komite-hod", label: "HOD", nama: "Komite KSO — HOD: putuskan jalur cepat & beri pendapat" },
  { tab: "agenda", fitur: "kso-komite-agenda", label: "Agenda Forum", nama: "Komite KSO — Komite: agenda forum & usulan ke Direksi" },
  { tab: "direksi", fitur: "kso-komite-direksi", label: "Putusan Direksi", nama: "Komite KSO — Direksi: putusan, mandat, PKS" },
  { tab: "penawaran", fitur: "kso-komite-penawaran", label: "Penawaran", nama: "Komite KSO — Admin Sales: terbitkan penawaran" },
  { tab: "teknik", fitur: "kso-komite-teknik", label: "Jadwal Pasang", nama: "Komite KSO — Teknik: serah terima alat" },
  { tab: "kpi", fitur: "kso-komite-kpi", label: "KPI AM", nama: "Komite KSO — KPI AM" },
];

type U = (AccessUser & { am_id?: string | null; hod_key?: string | null; role?: string | null }) | null | undefined;

function lama(u: U, tab: TabKso): boolean {
  if (!u) return false;
  if (tab === "saya") return !!u.am_id;
  if (tab === "hod") return !!u.hod_key;
  if (tab === "direksi") return u.role === "direktur";
  return false;
}

export function canTabKso(u: U, tab: TabKso, aksi: "view" | "edit" = "view"): boolean {
  const t = TAB_KSO.find((x) => x.tab === tab);
  return !!t && canOrLegacy(u, t.fitur, lama(u, tab), aksi);
}

/** Menu Komite KSO tampil bila SATU tab saja boleh dilihat. */
export function canViewKsoKomite(u: U): boolean {
  return TAB_KSO.some((t) => canTabKso(u, t.tab));
}
