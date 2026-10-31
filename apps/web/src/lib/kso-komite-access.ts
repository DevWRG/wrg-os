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

export type TabKso = "saya" | "hod" | "agenda" | "direksi" | "sekretariat" | "penawaran" | "teknik" | "kpi";

export const TAB_KSO: { tab: TabKso; fitur: string; label: string; nama: string }[] = [
  { tab: "saya", fitur: "kso-komite", label: "Rencana Saya", nama: "Komite KSO — Rencana Saya (AM, baca saja)" },
  { tab: "hod", fitur: "kso-komite-hod", label: "HOD", nama: "Komite KSO — HOD: putuskan jalur cepat & beri pendapat" },
  { tab: "agenda", fitur: "kso-komite-agenda", label: "Agenda Forum", nama: "Komite KSO — Komite: agenda forum & usulan ke Direksi" },
  { tab: "direksi", fitur: "kso-komite-direksi", label: "Putusan Direksi", nama: "Komite KSO — Direksi: putusan & mandat negosiasi" },
  { tab: "sekretariat", fitur: "kso-komite-sekretariat", label: "Sekretariat", nama: "Komite KSO — Sekretariat: penawaran, cocokkan PKS, catat hasil" },
  { tab: "penawaran", fitur: "kso-komite-penawaran", label: "Penawaran", nama: "Komite KSO — Admin Sales (cadangan): terbitkan penawaran" },
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
  if (!t) return false;
  // Putusan Direksi: role admin tidak otomatis lolos (keputusan Direktur 20 Okt) — sama dengan
  // putuskanIzin di API. Superuser (grup Administrator) tetap lolos lewat canOrLegacy.
  const v = tab === "direksi" && u?.role === "admin" ? { ...u, role: null } : u;
  return canOrLegacy(v, t.fitur, lama(v, tab), aksi);
}

/**
 * Susunan Komite (jabatan & pemegang, migrasi 242) — bukan tab: panel yang terlihat oleh semua
 * pembuka menu; MENGUBAH hanya lewat centang fitur ini atau grup superuser (role admin tidak
 * otomatis — API repo/kso-komite-susunan.ts bolehUbahSusunan yang menentukan).
 */
export const FITUR_SUSUNAN = { key: "kso-komite-susunan", name: "Komite KSO — Susunan Komite: ubah jabatan & pemegang" };

/**
 * Bottom Line Alat (F172, migrasi 256 + 263, model GPM Pedoman v01). Tab tersendiri, tiga fitur:
 *   kso-komite-bottomline        lihat = Forum/HOD/Finance · ubah = Direktur (keputusan, parameter zona)
 *   kso-komite-bottomline-angka  ubah = Finance (HPP standar, biaya reagen, QC, harga pasar)
 *   kso-komite-bottomline-real   lihat = Direktur (real bottom) · ubah = catat promo/dukungan prinsipal
 * Gate lama = role direktur. Role admin TIDAK otomatis lolos (data HPP & biaya; role admin dipakai
 * juga HOD). API repo/kso-komite-bottomline.ts izinBottomLine yang menentukan; ini hanya menu/tab.
 */
export const FITUR_BOTTOMLINE = [
  { key: "kso-komite-bottomline", name: "Komite KSO — Bottom Line Alat: lihat (Forum/HOD/Finance) · ubah = keputusan Direktur" },
  { key: "kso-komite-bottomline-angka", name: "Komite KSO — Bottom Line Alat: angka Finance (HPP standar, biaya reagen, harga pasar)" },
  { key: "kso-komite-bottomline-real", name: "Komite KSO — Bottom Line Alat: real bottom (lihat = Direktur, ubah = catat dukungan prinsipal)" },
];

/** Tab Bottom Line tampil bila salah satu dari tiga fitur boleh (lihat atau ubah). */
export function canBottomLine(u: U): boolean {
  const v = u?.role === "admin" ? { ...u, role: null } : u;
  const lama = v?.role === "direktur";
  return FITUR_BOTTOMLINE.some((f) => canOrLegacy(v, f.key, lama, "view") || canOrLegacy(v, f.key, lama, "edit"));
}

/** Menu Komite KSO tampil bila SATU tab saja boleh dilihat. */
export function canViewKsoKomite(u: U): boolean {
  return TAB_KSO.some((t) => canTabKso(u, t.tab)) || canBottomLine(u);
}
