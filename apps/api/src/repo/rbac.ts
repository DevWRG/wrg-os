// RBAC — Grup Akses + izin per-fitur (lihat infra/postgres/init/044_rbac.sql).
// app_user ─< app_user_group >─ access_group ─< access_permission >─ feature.
// Izin efektif user = gabungan (OR) izin semua grupnya; superuser bypass.

import { db } from "../db.js";

export type Action = "view" | "create" | "edit" | "delete";

export interface FeatureRow {
  key: string; name: string; section: string; path: string; sort: number; active: boolean;
}
export interface PermRow {
  feature_key: string; active: boolean;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean;
}
export interface GroupRow {
  id: number; key: string; name: string; description: string | null;
  is_system: boolean; superuser: boolean; member_count: number;
}
export interface GroupDetail {
  id: number; key: string; name: string; description: string | null; is_system: boolean; superuser: boolean;
  members: { id: string; email: string; name: string | null }[];
  permissions: PermRow[];
}
export interface EffectivePerm { active: boolean; view: boolean; create: boolean; edit: boolean; delete: boolean }
export interface Effective {
  superuser: boolean;
  groups: { id: number; key: string; name: string }[];
  permissions: Record<string, EffectivePerm>;
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function listFeatures(): Promise<FeatureRow[]> {
  const rows = await db()`SELECT key, name, section, path, sort, active FROM feature ORDER BY sort, name`;
  return rows.map((r) => ({ key: String(r.key), name: String(r.name), section: String(r.section), path: String(r.path), sort: Number(r.sort), active: r.active !== false }));
}

export interface FeatureInput { key: string; name: string; section: string; path: string; sort: number }

// Upsert katalog fitur dari menu (tombol "Sync Fitur"). Idempoten; fitur yang
// hilang dari menu TIDAK dihapus (izin historis aman) — tapi DINONAKTIFKAN
// (active=false) supaya tak lagi muncul di matriks Akses Grup. Tanpa ini fitur
// "zombie" (mis. 'sales'/Sales Performance yg sudah dilebur ke Sales Analytics)
// tetap bisa dicentang admin padahal tak ada item menu yg memakainya → hak
// akses terasa tidak sinkron dgn sidebar.
export async function syncFeatures(rows: FeatureInput[]): Promise<{ upserted: number; deactivated: number }> {
  const sql = db();
  const keys: string[] = [];
  for (const r of rows) {
    if (!r.key) continue;
    await sql`
      INSERT INTO feature (key, name, section, path, sort, active)
      VALUES (${r.key}, ${r.name}, ${r.section}, ${r.path}, ${r.sort ?? 0}, true)
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort, active = true`;
    keys.push(r.key);
  }
  // Katalog kosong = kemungkinan bug pemanggil → jangan matikan seluruh fitur.
  if (keys.length === 0) return { upserted: 0, deactivated: 0 };
  const off = await sql`UPDATE feature SET active = false WHERE active AND key <> ALL(${keys}) RETURNING key`;
  return { upserted: keys.length, deactivated: off.length };
}

export async function listGroups(): Promise<GroupRow[]> {
  const rows = await db()`
    SELECT g.id, g.key, g.name, g.description, g.is_system, g.superuser,
           (SELECT count(*)::int FROM app_user_group m WHERE m.group_id = g.id) AS member_count
    FROM access_group g ORDER BY g.is_system DESC, g.name`;
  return rows.map((r) => ({
    id: Number(r.id), key: String(r.key), name: String(r.name),
    description: r.description ? String(r.description) : null,
    is_system: r.is_system === true, superuser: r.superuser === true, member_count: Number(r.member_count),
  }));
}

export async function getGroup(id: number): Promise<GroupDetail | null> {
  const sql = db();
  const [g] = await sql`SELECT id, key, name, description, is_system, superuser FROM access_group WHERE id = ${id}`;
  if (!g) return null;
  const members = await sql`
    SELECT u.id, u.email, u.name FROM app_user_group m JOIN app_user u ON u.id = m.user_id
    WHERE m.group_id = ${id} ORDER BY u.name NULLS LAST, u.email`;
  const perms = await sql`SELECT feature_key, active, can_view, can_create, can_edit, can_delete FROM access_permission WHERE group_id = ${id}`;
  return {
    id: Number(g.id), key: String(g.key), name: String(g.name), description: g.description ? String(g.description) : null,
    is_system: g.is_system === true, superuser: g.superuser === true,
    members: members.map((m) => ({ id: String(m.id), email: String(m.email), name: m.name ? String(m.name) : null })),
    permissions: perms.map(toPermRow),
  };
}

function toPermRow(r: Record<string, unknown>): PermRow {
  return {
    feature_key: String(r.feature_key), active: r.active === true,
    can_view: r.can_view === true, can_create: r.can_create === true,
    can_edit: r.can_edit === true, can_delete: r.can_delete === true,
  };
}

export async function createGroup(name: string, description?: string | null): Promise<{ ok: boolean; id?: number; error?: string }> {
  const key = slug(name);
  if (!key) return { ok: false, error: "nama grup wajib" };
  const sql = db();
  const rows = await sql`
    INSERT INTO access_group (key, name, description) VALUES (${key}, ${name.trim()}, ${description ?? null})
    ON CONFLICT (key) DO NOTHING RETURNING id`;
  if (rows.length === 0) return { ok: false, error: "grup dgn nama itu sudah ada" };
  return { ok: true, id: Number(rows[0].id) };
}

export async function updateGroup(id: number, patch: { name?: string; description?: string | null }): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    UPDATE access_group SET
      name = COALESCE(${patch.name ?? null}, name),
      description = ${patch.description === undefined ? sql`description` : patch.description}
    WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function deleteGroup(id: number): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const [g] = await sql`SELECT is_system FROM access_group WHERE id = ${id}`;
  if (!g) return { ok: false, error: "grup tak ditemukan" };
  if (g.is_system === true) return { ok: false, error: "grup sistem tak bisa dihapus" };
  await sql`DELETE FROM access_group WHERE id = ${id}`;
  return { ok: true };
}

// Upsert seluruh baris matriks yang dikirim (UI mengirim grid penuh).
export async function setPermissions(id: number, rows: PermRow[]): Promise<boolean> {
  const sql = db();
  const [g] = await sql`SELECT id FROM access_group WHERE id = ${id}`;
  if (!g) return false;
  for (const r of rows) {
    await sql`
      INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
      VALUES (${id}, ${r.feature_key}, ${!!r.active}, ${!!r.can_view}, ${!!r.can_create}, ${!!r.can_edit}, ${!!r.can_delete})
      ON CONFLICT (group_id, feature_key) DO UPDATE SET
        active = EXCLUDED.active, can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
        can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete`;
  }
  return true;
}

// Ganti seluruh anggota grup dgn daftar userIds.
export async function setMembers(id: number, userIds: string[]): Promise<boolean> {
  const sql = db();
  const [g] = await sql`SELECT id FROM access_group WHERE id = ${id}`;
  if (!g) return false;
  await sql`DELETE FROM app_user_group WHERE group_id = ${id}`;
  for (const uid of userIds) {
    await sql`INSERT INTO app_user_group (user_id, group_id) VALUES (${uid}, ${id}) ON CONFLICT DO NOTHING`;
  }
  return true;
}

// "Salin Hak" — salin matriks dari grup sumber ke tujuan (timpa).
export async function copyPermissions(srcId: number, dstId: number): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const [s] = await sql`SELECT id FROM access_group WHERE id = ${srcId}`;
  const [d] = await sql`SELECT id FROM access_group WHERE id = ${dstId}`;
  if (!s || !d) return { ok: false, error: "grup sumber/tujuan tak ditemukan" };
  await sql`
    INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
    SELECT ${dstId}, feature_key, active, can_view, can_create, can_edit, can_delete
    FROM access_permission WHERE group_id = ${srcId}
    ON CONFLICT (group_id, feature_key) DO UPDATE SET
      active = EXCLUDED.active, can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete`;
  return { ok: true };
}

// Izin efektif user: gabungan OR semua grup. superuser bila salah satu grup superuser.
export async function effectivePermissions(userId: string): Promise<Effective> {
  const sql = db();
  const groups = await sql`
    SELECT g.id, g.key, g.name, g.superuser
    FROM app_user_group m JOIN access_group g ON g.id = m.group_id
    WHERE m.user_id = ${userId} ORDER BY g.name`;
  const superuser = groups.some((g) => g.superuser === true);
  const permissions: Record<string, EffectivePerm> = {};
  if (superuser) {
    // semua fitur aktif → akses penuh
    const feats = await sql`SELECT key FROM feature WHERE active`;
    for (const f of feats) permissions[String(f.key)] = { active: true, view: true, create: true, edit: true, delete: true };
  } else {
    const rows = await sql`
      SELECT ap.feature_key,
             bool_or(ap.active) AS active, bool_or(ap.can_view) AS v, bool_or(ap.can_create) AS c,
             bool_or(ap.can_edit) AS e, bool_or(ap.can_delete) AS d
      FROM app_user_group m JOIN access_permission ap ON ap.group_id = m.group_id
      WHERE m.user_id = ${userId} GROUP BY ap.feature_key`;
    for (const r of rows) {
      permissions[String(r.feature_key)] = { active: r.active === true, view: r.v === true, create: r.c === true, edit: r.e === true, delete: r.d === true };
    }
  }
  return {
    superuser,
    groups: groups.map((g) => ({ id: Number(g.id), key: String(g.key), name: String(g.name) })),
    permissions,
  };
}

// Cek 1 izin (utk enforcement API). superuser selalu true.
export async function userCan(userId: string, feature: string, action: Action): Promise<boolean> {
  const eff = await effectivePermissions(userId);
  if (eff.superuser) return true;
  const p = eff.permissions[feature];
  if (!p || !p.active) return false;
  return action === "view" ? p.view : action === "create" ? p.create : action === "edit" ? p.edit : p.delete;
}
