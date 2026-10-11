// Gerbang izin route BFF per FITUR MENU — keputusannya SAMA dengan gerbang
// halaman di (dashboard)/layout.tsx (navVisible), ditambah cek aksi
// create/edit/delete bila matriks Akses Grup mengaturnya.
//
// Kenapa perlu: middleware hanya memastikan cookie sesi SAH. Tanpa gerbang di
// route, halaman yang sudah redirect ke /akses-ditolak tetap bisa dilewati
// lewat curl ke /api/... — terbukti di uji dev 11 Okt 2026: user login TANPA
// grup bisa membaca semua approval, mengubah config chain approval, dan
// membuat approval atas nama orang lain.

import { sessionUser, type SessionUserSrv } from "./admin-guard";
import { featureKey, findNavItem, navVisible } from "./nav";
import { can, type Action } from "./perms";

export type GuardResult = { ok: true; me: SessionUserSrv } | { ok: false; res: Response };

// Pure — dipakai requireFeature & diuji unit. `path` = url menu pemilik fitur
// (mis. "/approval-requests"), bukan path API.
export function featureAllowed(me: SessionUserSrv, path: string, action: Action): boolean {
  const item = findNavItem(path);
  if (!item) return false; // salah ketik path = tertutup, bukan terbuka
  if (!navVisible(me, item)) return false;
  if (action === "view") return true;
  // Lihat sudah lolos. Aksi tulis hanya dibatasi kalau matriks punya baris
  // untuk fitur ini — selaras canOrLegacy: belum diatur = ikut gerbang lihat.
  const key = item.feature ?? featureKey(item.url);
  if (me.permissions?.[key]) return can(me, key, action);
  return true;
}

export async function requireFeature(path: string, action: Action = "view"): Promise<GuardResult> {
  const me = await sessionUser();
  if (!me) return { ok: false, res: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (!featureAllowed(me, path, action)) {
    return { ok: false, res: Response.json({ error: `forbidden — tak punya izin ${action} untuk menu ini` }, { status: 403 }) };
  }
  return { ok: true, me };
}

// Nama yang dicatat sebagai pelaku (pengaju, peninjau, pembuat draft) — dari
// SESI, tak pernah dari body request.
export function actorName(me: SessionUserSrv): string {
  return me.name?.trim() || me.email;
}
