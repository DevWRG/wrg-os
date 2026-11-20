// Logika murni sidebar (dipakai components/layout/app-sidebar.tsx, diuji unit):
// menu aktif, pencarian menu, dan grup yang terbuka secara default.

import type { NavGroup, NavItem } from "./nav";

export function menuAktif(it: NavItem, pathname: string): boolean {
  const cocok = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  return (it.exact ? pathname === it.url : cocok(it.url)) || (it.matchPrefix?.some(cocok) ?? false);
}

// Cocokkan setiap kata kunci ke judul menu ATAU label grup (mis. "faktur"
// menemukan "DO Belum Difaktur", "finance kas" menemukan "Kas Station").
// Tanpa membedakan huruf besar/kecil & aksen.
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function saringMenu(groups: NavGroup[], cari: string): NavGroup[] {
  const kata = norm(cari).split(/\s+/).filter(Boolean);
  if (kata.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const teks = norm(`${it.title} ${g.label}`);
        return kata.every((k) => teks.includes(k));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

// Sidebar yang pendek tak perlu dilipat: di bawah ambang ini semua grup terbuka.
export const AMBANG_LIPAT = 20;

export function grupTerbukaAwal(groups: NavGroup[], pathname: string): Set<string> {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total <= AMBANG_LIPAT) return new Set(groups.map((g) => g.label));
  return new Set(groups.filter((g) => g.items.some((it) => menuAktif(it, pathname))).map((g) => g.label));
}
