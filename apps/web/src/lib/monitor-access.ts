// Gerbang proxy /api/monitor/[...path] — sub-path apps/api /monitor/* dipetakan ke
// menu Monitor pemiliknya, supaya izinnya sama dengan halaman yang memakainya.
// Segmen di luar peta = tertutup kecuali admin (requireFeature menolak path kosong).
//
// Aksi: baca & "generate" (rekap/resume/digest — fungsi inti menu itu sendiri)
// cukup izin lihat; ubah data (members, kategori pola, grup) butuh izin edit.

import type { Action } from "@/lib/perms";

const MENU: Record<string, readonly string[]> = {
  members: ["/monitor/members"],
  rekap: ["/monitor/rekap"],
  stats: ["/monitor/rekap"], // infografis digest di halaman Rekap
  digests: ["/monitor/rekap"],
  resume: ["/monitor/resume"],
  pola: ["/monitor/pola"],
  groups: ["/monitor/pola", "/monitor/members"],
};

const GENERATE = new Set(["rekap/generate", "resume/generate", "digests"]);

export function monitorGate(sub: string, method: "GET" | "POST"): { menus: readonly string[]; action: Action } | null {
  const menus = MENU[sub.split("/")[0] ?? ""];
  if (!menus) return null;
  if (method === "GET" || GENERATE.has(sub)) return { menus, action: "view" };
  return { menus, action: "edit" };
}
