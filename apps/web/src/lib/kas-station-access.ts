// Hak akses F33 Kas Station Reconcile Harian Cabang (/kas-station).
//
// Dua kunci izin di matriks Akses Grup (sisi station dan sisi pusat dipisah supaya
// siapa yang mengisi dan siapa yang approve bisa diatur per grup tanpa ubah kode):
//   - `kas-station`        → station/cabang: view = lihat, create = catat kas harian & ajukan rekap,
//                            edit = ubah catatan, delete = hapus catatan.
//   - `kas-station-review` → pusat: view = lihat rekap semua cabang, edit = approve/reject & realisasi dana.
// Fallback identitas (selama grup belum punya baris izinnya): direktur / admin / superuser SAJA —
// siapa yang mengisi dan meng-approve belum ditetapkan bisnis. Begitu Sync Fitur dijalankan, matriks
// Akses Grup yang menang (canOrLegacy); jadi grup station & pusat dicentang setelah Sync Fitur.
//
// Gateway menyuntik x-service-token yang mem-bypass JWT apps/api, jadi izin WAJIB diperiksa di BFF
// (app/api/kas-station/[[...path]]) — menyembunyikan menu tidak menutup endpoint.

import { canOrLegacy, type Action } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR_STATION = "kas-station";
export const FITUR_REVIEW = "kas-station-review";

type Fitur = typeof FITUR_STATION | typeof FITUR_REVIEW;

/** Salah satu dari pasangan (fitur, aksi) ini cukup. */
export type Izin = ReadonlyArray<readonly [Fitur, Action]>;

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

function fallbackIdentitas(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  return r === "direktur" || r === "admin" || u.superuser === true;
}

export function bolehFitur(u: AccessUser | null | undefined, fitur: Fitur, aksi: Action = "view"): boolean {
  if (!u) return false;
  return canOrLegacy(u, fitur, fallbackIdentitas(u), aksi);
}

export const canKasStation = (u?: AccessUser | null, aksi: Action = "view"): boolean => bolehFitur(u, FITUR_STATION, aksi);
export const canKasStationReview = (u?: AccessUser | null, aksi: Action = "view"): boolean => bolehFitur(u, FITUR_REVIEW, aksi);

/** Menu & halaman terbuka bila salah satu sisi boleh melihat. */
export const canViewKasStation = (u?: AccessUser | null): boolean => canKasStation(u) || canKasStationReview(u);

export function bolehSalahSatu(u: AccessUser | null | undefined, izin: Izin): boolean {
  return izin.some(([fitur, aksi]) => bolehFitur(u, fitur, aksi));
}

const SEGMEN = "[^/]+";
const re = (s: string) => new RegExp(`^${s}$`);

const STATION_LIHAT: Izin = [[FITUR_STATION, "view"]];
const REKAP_LIHAT: Izin = [[FITUR_STATION, "view"], [FITUR_REVIEW, "view"]];

const RUTE: Record<string, ReadonlyArray<readonly [RegExp, Izin]>> = {
  GET: [
    [re("cabang"), REKAP_LIHAT],
    [re("harian"), STATION_LIHAT],
    [re(`harian/${SEGMEN}`), STATION_LIHAT],
    [re("rekap"), REKAP_LIHAT],
    [re(`rekap/${SEGMEN}`), REKAP_LIHAT],
  ],
  POST: [
    [re("harian"), [[FITUR_STATION, "create"]]],
    [re(`harian/${SEGMEN}/transaksi`), [[FITUR_STATION, "create"]]],
    [re("rekap"), [[FITUR_STATION, "create"]]],
    [re(`rekap/${SEGMEN}/submit`), [[FITUR_STATION, "create"]]],
    [re(`rekap/${SEGMEN}/decide`), [[FITUR_REVIEW, "edit"]]],
    [re(`rekap/${SEGMEN}/realisasi`), [[FITUR_REVIEW, "edit"]]],
  ],
  PATCH: [
    [re(`harian/${SEGMEN}`), [[FITUR_STATION, "edit"]]],
    [re(`harian/${SEGMEN}/transaksi/${SEGMEN}`), [[FITUR_STATION, "edit"]]],
  ],
  DELETE: [
    [re(`harian/${SEGMEN}`), [[FITUR_STATION, "delete"]]],
    [re(`harian/${SEGMEN}/transaksi/${SEGMEN}`), [[FITUR_STATION, "delete"]]],
  ],
};

/** Izin untuk satu sub-route BFF; null = rute tidak dikenal (ditolak, tidak diteruskan ke API). */
export function izinUntukRute(method: string, sub: string): Izin | null {
  for (const [pola, izin] of RUTE[method.toUpperCase()] ?? []) if (pola.test(sub)) return izin;
  return null;
}

/** Query yang diteruskan ke API — daftar putih, supaya klien tak bisa menyelipkan parameter lain. */
export const QUERY_DITERUSKAN = ["cabang", "dari", "sampai", "limit", "status"] as const;
