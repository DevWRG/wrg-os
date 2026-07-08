import { db } from "../db.js";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../auth.js";

// app_user — identitas pengguna dashboard. Verifikasi kredensial untuk login.

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  title: string | null;
}

// Map baris DB → AppUser (title bisa null untuk user lama tanpa jabatan).
function toAppUser(r: Record<string, unknown>): AppUser {
  return {
    id: String(r.id),
    email: String(r.email),
    name: r.name ? String(r.name) : null,
    role: String(r.role),
    title: r.title ? String(r.title) : null,
  };
}

export async function getUserByEmail(email: string) {
  const sql = db();
  const rows = await sql`
    SELECT id, email, password_hash, name, role, title FROM app_user WHERE email = ${email.toLowerCase()}
  `;
  return rows[0] ?? null;
}

// Idempoten per email (ON CONFLICT DO NOTHING). Untuk seed admin / register ops.
export async function createUser(
  email: string,
  password: string,
  name?: string,
  role = "user",
  title?: string,
): Promise<AppUser> {
  const sql = db();
  const rows = await sql`
    INSERT INTO app_user (email, password_hash, name, role, title)
    VALUES (${email.toLowerCase()}, ${hashPassword(password)}, ${name ?? null}, ${role}, ${title ?? null})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, role, title
  `;
  if (rows.length > 0) return toAppUser(rows[0]);
  return toAppUser(await getUserByEmail(email));
}

// Login fleksibel: identifier bisa EMAIL, username (name/panggilan), atau nomor WA.
export async function getUserByIdentifier(identifier: string) {
  const sql = db();
  const v = String(identifier ?? "").trim();
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  const phoneOk = digits.length >= 6;
  const rows = await sql`
    SELECT id, email, password_hash, name, role, title, active
    FROM app_user
    WHERE lower(email) = lower(${v})
       OR lower(name) = lower(${v})
       OR (${phoneOk} AND wa_number IS NOT NULL
           AND regexp_replace(wa_number, '[^0-9]', '', 'g') = ${digits})
    ORDER BY (lower(email) = lower(${v})) DESC, (lower(name) = lower(${v})) DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function verifyCredentials(
  identifier: string,
  password: string,
): Promise<AppUser | null> {
  const u = await getUserByIdentifier(identifier);
  if (!u) return null;
  if (u.active === false) return null; // akun nonaktif tak bisa login
  if (!verifyPassword(password, String(u.password_hash))) return null;
  await db()`UPDATE app_user SET last_login_at = now() WHERE id = ${u.id}`;
  return toAppUser(u);
}

export async function countUsers(): Promise<number> {
  const sql = db();
  const [r] = await sql`SELECT count(*)::int AS n FROM app_user`;
  return Number(r.n);
}

// ── Manajemen akses (admin) ───────────────────────────────────────────────
export interface AppUserRow extends AppUser {
  active: boolean;
  wa_number: string | null;
  hod_key: string | null;
  last_login_at: string | null;
  force_change: boolean;
  created_at: string;
}

// Map baris DB → AppUserRow (hindari duplikasi 3 tempat).
function toAppUserRow(r: Record<string, unknown>): AppUserRow {
  return {
    ...toAppUser(r),
    active: r.active !== false,
    wa_number: r.wa_number ? String(r.wa_number) : null,
    hod_key: r.hod_key ? String(r.hod_key) : null,
    last_login_at: r.last_login_at ? String(r.last_login_at) : null,
    force_change: r.force_change === true,
    created_at: String(r.created_at),
  };
}

export async function listAppUsers(): Promise<AppUserRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT id, email, name, role, title, active, wa_number, hod_key,
           last_login_at::text AS last_login_at, force_change, created_at::text AS created_at
    FROM app_user ORDER BY created_at
  `;
  return rows.map(toAppUserRow);
}

// Password acak ramah-ketik (tanpa karakter ambigu).
export function generatePassword(len = 10): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += abc[buf[i] % abc.length];
  return out;
}

// Set password (admin reset / set). force=true → user wajib ganti saat login.
export async function setUserPassword(id: string, password: string, force = false): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    UPDATE app_user SET password_hash = ${hashPassword(password)}, force_change = ${force}
    WHERE id = ${id} RETURNING id
  `;
  return rows.length > 0;
}

// Self change-password: verifikasi current dulu.
export async function changeOwnPassword(id: string, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const [u] = await sql`SELECT password_hash FROM app_user WHERE id = ${id}`;
  if (!u) return { ok: false, error: "user tak ditemukan" };
  if (!verifyPassword(current, String(u.password_hash))) return { ok: false, error: "password lama salah" };
  await sql`UPDATE app_user SET password_hash = ${hashPassword(next)}, force_change = false WHERE id = ${id}`;
  return { ok: true };
}

export async function updateAppUser(
  id: string,
  patch: { name?: string | null; role?: string; title?: string | null; active?: boolean; wa_number?: string | null; hod_key?: string | null },
): Promise<AppUserRow | null> {
  const sql = db();
  await sql`
    UPDATE app_user SET
      name = COALESCE(${patch.name ?? null}, name),
      role = COALESCE(${patch.role ?? null}, role),
      title = ${patch.title === undefined ? sql`title` : patch.title},
      active = COALESCE(${patch.active ?? null}, active),
      wa_number = ${patch.wa_number === undefined ? sql`wa_number` : patch.wa_number},
      hod_key = ${patch.hod_key === undefined ? sql`hod_key` : (patch.hod_key || null)}
    WHERE id = ${id}
  `;
  const [r] = await sql`SELECT id, email, name, role, title, active, wa_number, hod_key, last_login_at::text AS last_login_at, force_change, created_at::text AS created_at FROM app_user WHERE id = ${id}`;
  return r ? toAppUserRow(r) : null;
}

export async function deleteAppUser(id: string): Promise<boolean> {
  const rows = await db()`DELETE FROM app_user WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function getAppUserById(id: string): Promise<AppUserRow | null> {
  const [r] = await db()`SELECT id, email, name, role, title, active, wa_number, hod_key, last_login_at::text AS last_login_at, force_change, created_at::text AS created_at FROM app_user WHERE id = ${id}`;
  return r ? toAppUserRow(r) : null;
}

// Bikin akun login dari roster master_user (by am_id) — butuh email.
export async function createUserFromRoster(amId: string, email: string, password: string, role = "user"): Promise<{ ok: boolean; error?: string; user?: AppUser }> {
  const sql = db();
  const [m] = await sql`SELECT nama, panggilan, role AS roster_role, wa_number FROM master_user WHERE am_id = ${amId}`;
  if (!m) return { ok: false, error: "am_id tak ada di roster" };
  const name = m.nama ? String(m.nama) : (m.panggilan ? String(m.panggilan) : email);
  const rows = await sql`
    INSERT INTO app_user (email, password_hash, name, role, wa_number)
    VALUES (${email.toLowerCase()}, ${hashPassword(password)}, ${name}, ${role}, ${m.wa_number ?? null})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, role, title
  `;
  if (rows.length === 0) return { ok: false, error: "email sudah dipakai" };
  return { ok: true, user: toAppUser(rows[0]) };
}
