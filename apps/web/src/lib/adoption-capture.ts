// Pencatatan pemakaian fitur (F58). Bagian MURNI di sini (diuji); pengiriman event ke apps/api
// ada di adoption-record.ts.
//
// Titik pencatatan:
//   action → gatewayFetch (gateway.ts): SEMUA route BFF lewat sana, dan di sana status respons
//            sudah diketahui, jadi hanya aksi tulis yang BERHASIL (2xx) yang dihitung.
//   view   → <UsageBeacon/> di layout dashboard → POST /api/adoption/view.
// Feature key = kunci menu (feature.key) dari katalog NAV — path yang tak terpetakan TIDAK ditebak.

import { featureKey, findNavItem } from "./nav";

export const ADOPTION_FEATURE_KEY = "adoption";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Rute yang bukan "aksi kerja": login/sesi, health, administrasi akses, dan tracker sendiri.
const EXCLUDED_API_PREFIXES = ["/api/auth", "/api/health", "/api/admin", "/api/adoption"];

const keyOf = (path: string): string | null => {
  const item = findNavItem(path);
  if (!item) return null;
  const k = item.feature ?? featureKey(item.url);
  return k === ADOPTION_FEATURE_KEY ? null : k;
};

const isExcluded = (p: string) => EXCLUDED_API_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));

/** feature_key untuk request BFF `/api/<menu>/...` bermetode tulis; null = jangan catat. */
export function actionFeatureFor(pathname: string | null | undefined, method: string): string | null {
  if (!pathname || !WRITE_METHODS.has(method.toUpperCase())) return null;
  const p = pathname.replace(/\/+$/, "");
  if (!p.startsWith("/api/") || isExcluded(p)) return null;
  return keyOf(p.slice(4));
}

/** feature_key untuk halaman dashboard `/<menu>/...`; null = bukan halaman fitur / API / tracker. */
export function viewFeatureFor(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p.startsWith("/api/") || p === "/api") return null;
  return keyOf(p);
}
