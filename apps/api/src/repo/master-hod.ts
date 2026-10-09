// Master HoD (migrasi 198) — satu-satunya sumber daftar HoD kanonik.
//
// Dibaca banyak jalur panas (papan WatchPoint, resolver atasan_raw per baris
// karyawan, NPK), jadi disimpan di memori sebentar. 60 detik cukup: perubahan
// daftar HoD jarang, dan sesudah edit lewat SQL paling lama semenit sudah
// terbaca tanpa restart.

import { db, isDbEnabled } from "../db.js";
import type { Hod } from "../hod-resolver.js";

const TTL_MS = 60_000;
let cache: { at: number; rows: Hod[] } | null = null;

/** HoD aktif, urut `urutan`. DB mati → [] (bukan daftar cadangan di kode). */
export async function listHods(): Promise<Hod[]> {
  if (!isDbEnabled()) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await db()<{ hod_key: string; nama: string; panggilan: string; peran: string; alias: string[]; petunjuk_peran: string[] }[]>`
    SELECT hod_key, nama, panggilan, peran, alias, petunjuk_peran
    FROM master_hod WHERE aktif ORDER BY urutan, hod_key`;
  const hods = rows.map((r) => ({
    key: r.hod_key,
    name: r.nama,
    panggilan: r.panggilan,
    peran: r.peran,
    role: `HoD ${r.peran}`,
    aliases: (r.alias ?? []).map((a) => a.toLowerCase()),
    roleHints: (r.petunjuk_peran ?? []).map((a) => a.toLowerCase()),
  }));
  cache = { at: Date.now(), rows: hods };
  return hods;
}

/** Bentuk ringkas untuk dropdown/label di web. */
export async function listHodOptions(): Promise<{ key: string; name: string; panggilan: string; peran: string; role: string; label: string }[]> {
  return (await listHods()).map((h) => ({
    key: h.key, name: h.name, panggilan: h.panggilan, peran: h.peran, role: h.role,
    label: `${h.panggilan} — ${h.peran}`,
  }));
}
