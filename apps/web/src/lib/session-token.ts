// Verifikasi tanda tangan cookie sesi (`wrg_session`) di EDGE runtime.
//
// Kenapa ada di sini dan bukan memanggil /auth/me: ini dipakai middleware, yang
// jalan di edge — `node:crypto` tak tersedia, dan satu fetch ke apps/api per
// request akan menempel di setiap navigasi. Web Crypto cukup: token yang
// diterbitkan `apps/api/src/auth.ts` adalah JWT HS256 polos, jadi tanda tangannya
// bisa diverifikasi tanpa jaringan.
//
// Ini gerbang AUTENTIKASI (token ini sah atau tidak), BUKAN otorisasi. Siapa
// boleh apa tetap diputuskan `sessionUser()`/`can()` di route handler dan
// `(dashboard)/layout.tsx`.
//
// Rahasianya harus sama persis dengan `jwtSecret()` di apps/api — termasuk
// fallback-nya, supaya dev lokal tanpa .env tetap jalan.
const FALLBACK_SECRET = "dev-insecure-secret-change-me";

const encoder = new TextEncoder();
let cachedKey: Promise<CryptoKey> | null = null;
let cachedSecret: string | null = null;

function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.JWT_SECRET ?? FALLBACK_SECRET;
  // Rahasia bisa berubah antar-instance saat hot reload dev; cache dikunci ke
  // nilainya, bukan cuma "sudah pernah dibuat".
  if (!cachedKey || cachedSecret !== secret) {
    cachedSecret = secret;
    cachedKey = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }
  return cachedKey;
}

// Dibangun di atas ArrayBuffer eksplisit: `new Uint8Array(len)` bertipe
// Uint8Array<ArrayBufferLike>, dan crypto.subtle menuntut ArrayBuffer (bukan
// SharedArrayBuffer) — tanpa ini tsc menolak.
function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** true HANYA bila token ber-tanda-tangan sah (HS256 + JWT_SECRET) dan belum
 * kedaluwarsa. Semua bentuk cacat — bukan 3 bagian, base64 rusak, payload bukan
 * JSON — dijawab false, tak pernah melempar. */
export async function sessionTokenValid(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      base64urlToBytes(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1]))) as {
      exp?: unknown;
    };
    // `exp` diisi signJwt untuk semua token yang kita terbitkan. Token tanpa exp
    // berarti bukan terbitan kita (atau format lama) → tolak, jangan diloloskan
    // sebagai "tak ada batas waktu".
    if (typeof payload.exp !== "number") return false;
    return payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
