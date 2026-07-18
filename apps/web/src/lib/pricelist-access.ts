// Hak akses Pricelist berbasis jabatan (title) + role. Mengikuti aturan sesi
// yang ada: tolak bila tidak berhak (tanpa fallback dev-permisif).
//   title 'HoD Business' → edit setup + publish
//   title 'Purchasing'   → edit setup
//   title 'AM'           → lihat pricelist terpublikasi
//   role  'admin'        → semua

export interface AccessUser {
  role?: string | null;
  title?: string | null;
  superuser?: boolean;
  hod_key?: string | null;
}

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const isAdmin = (u?: AccessUser | null): boolean => norm(u?.role) === "admin";
const hasTitle = (u: AccessUser | null | undefined, title: string): boolean =>
  norm(u?.title) === title;

// AM (atau admin) boleh melihat menu/halaman Pricelist terpublikasi.
export function canViewPricelist(u?: AccessUser | null): boolean {
  return !!u && (isAdmin(u) || hasTitle(u, "am"));
}

// HoD Business / Purchasing (atau admin) boleh mengisi & mengedit setup.
export function canEditPricelistSetup(u?: AccessUser | null): boolean {
  return !!u && (isAdmin(u) || hasTitle(u, "hod business") || hasTitle(u, "purchasing"));
}

// Hanya HoD Business (atau admin) yang boleh mempublikasikan.
export function canPublishPricelist(u?: AccessUser | null): boolean {
  return !!u && (isAdmin(u) || hasTitle(u, "hod business"));
}
