import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// Auth primitif tanpa dependency: password scrypt + JWT HS256. Sesi
// ditandatangani dengan JWT_SECRET. Enforcement opsional (AUTH_ENABLED).

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  const actual = scryptSync(pw, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function jwtSecret(): string {
  return process.env.JWT_SECRET ?? "dev-insecure-secret-change-me";
}

export function signJwt(payload: Record<string, unknown>, expSeconds = 86400): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + expSeconds }),
  ).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createHmac("sha256", jwtSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", jwtSecret()).update(data).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<
      string,
      unknown
    >;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
