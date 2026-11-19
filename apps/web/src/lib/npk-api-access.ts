// Gerbang proxy /api/npk/[...path] — dulu cuma cek sesi. Sub-path apps/api
// /npk/* dipetakan ke menu NPK pemiliknya; backend tetap menerapkan row-scope
// (admin → semua, HoD → diri sendiri, visibleAms untuk NPK AM). Skor milik satu
// orang (`scores/:id`) boleh dibuka pemegang menu "Saya"-nya — backend yang
// memastikan ia hanya mendapat skornya sendiri.
// Segmen di luar peta = null → route menolak kecuali admin.

import type { Action } from "@/lib/perms";

export function npkGate(sub: string, method: "GET" | "POST"): { menus: readonly string[]; action: Action } | null {
  const seg = sub.split("/");
  const am = seg[0] === "am";
  const rest = am ? seg.slice(1) : seg;
  const tim = am ? "/npk/am" : "/npk";
  const saya = am ? "/npk/am-self" : "/npk/self";
  if (method === "POST") return rest.length === 1 && rest[0] === "compute" ? { menus: [tim], action: "create" } : null;
  if (rest[0] !== "scores" || rest.length > 2) return null;
  return { menus: rest.length === 2 ? [tim, saya] : [tim], action: "view" };
}
