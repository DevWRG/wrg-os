import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../auth.js";

// app_user — identitas pengguna dashboard. Verifikasi kredensial untuk login.

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export async function getUserByEmail(email: string) {
  const sql = db();
  const rows = await sql`
    SELECT id, email, password_hash, name, role FROM app_user WHERE email = ${email.toLowerCase()}
  `;
  return rows[0] ?? null;
}

// Idempoten per email (ON CONFLICT DO NOTHING). Untuk seed admin / register ops.
export async function createUser(
  email: string,
  password: string,
  name?: string,
  role = "user",
): Promise<AppUser> {
  const sql = db();
  const rows = await sql`
    INSERT INTO app_user (email, password_hash, name, role)
    VALUES (${email.toLowerCase()}, ${hashPassword(password)}, ${name ?? null}, ${role})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, role
  `;
  if (rows.length > 0) {
    return {
      id: String(rows[0].id),
      email: String(rows[0].email),
      name: rows[0].name ? String(rows[0].name) : null,
      role: String(rows[0].role),
    };
  }
  const existing = await getUserByEmail(email);
  return {
    id: String(existing.id),
    email: String(existing.email),
    name: existing.name ? String(existing.name) : null,
    role: String(existing.role),
  };
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AppUser | null> {
  const u = await getUserByEmail(email);
  if (!u) return null;
  if (!verifyPassword(password, String(u.password_hash))) return null;
  return {
    id: String(u.id),
    email: String(u.email),
    name: u.name ? String(u.name) : null,
    role: String(u.role),
  };
}

export async function countUsers(): Promise<number> {
  const sql = db();
  const [r] = await sql`SELECT count(*)::int AS n FROM app_user`;
  return Number(r.n);
}
