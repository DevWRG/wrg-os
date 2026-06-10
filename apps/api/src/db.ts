import postgres from "postgres";

// Koneksi PostgreSQL lazy-singleton dari DATABASE_URL. Kalau env tidak di-set,
// apps/api tetap jalan (endpoint fallback ke mode tanpa-persist).
let _sql: ReturnType<typeof postgres> | null = null;

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export function db(): ReturnType<typeof postgres> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tidak di-set");
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL, { max: 5, onnotice: () => {} });
  }
  return _sql;
}

export async function pingDb(): Promise<boolean> {
  try {
    await db()`select 1`;
    return true;
  } catch {
    return false;
  }
}
