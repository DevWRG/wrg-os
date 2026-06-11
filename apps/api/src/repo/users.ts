import { db } from "../db.js";
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

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AppUser | null> {
  const u = await getUserByEmail(email);
  if (!u) return null;
  if (!verifyPassword(password, String(u.password_hash))) return null;
  return toAppUser(u);
}

export async function countUsers(): Promise<number> {
  const sql = db();
  const [r] = await sql`SELECT count(*)::int AS n FROM app_user`;
  return Number(r.n);
}
