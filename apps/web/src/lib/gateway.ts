// Server-only gateway helper. apps/web bertindak sebagai API gateway (BFF):
// browser memanggil /api/* di origin yang sama, lalu server meneruskan ke
// backend domain (apps/api, Hono). Pakai env server `API_URL` — JANGAN
// NEXT_PUBLIC_* di sini supaya base URL backend tidak ter-expose ke browser.

export function apiBaseUrl(): string {
  // Default: port @wrg/api (4000, sama di lokal & docker). Override via API_URL.
  return process.env.API_URL ?? "http://localhost:4000";
}

/** Path boleh diteruskan ke apps/api? Menolak segmen `.`/`..` — termasuk bentuk
 * ter-encode `%2e%2e` yang oleh WHATWG URL juga dihitung dot-segment — dan
 * backslash (dibaca `/` untuk skema http).
 *
 * Kenapa di sini: Next 16 men-decode `%2F` di param `[id]` biasa, jadi
 * `/api/print-specs/..%2F..%2Fusers` tiba di handler sebagai id `../../users`,
 * lalu `fetch()` menormalkan `/print-specs/../../users` → `/users` — dibawa
 * x-service-token (bypass JWT). Satu route yang lupa encodeURIComponent cukup
 * untuk membaca/menulis endpoint API mana pun (uji dev 12 Okt 2026). Yang sudah
 * encode pun tetap bisa naik satu tingkat lewat id `..`. Penjaga satu tempat
 * ini menutup semua route, termasuk yang belum ditulis. */
export function pathGatewayAman(path: string): boolean {
  const bagianPath = path.split(/[?#]/, 1)[0];
  if (bagianPath.includes("\\")) return false;
  for (const seg of bagianPath.split("/")) {
    let d: string;
    try {
      d = decodeURIComponent(seg);
    } catch {
      return false;
    }
    if (d === "." || d === "..") return false;
  }
  return true;
}

/** Fetch ke backend domain dengan base URL tergabung + no-store.
 * BFF tepercaya: sertakan x-service-token (API_SERVICE_TOKEN) bila di-set,
 * supaya apps/api mengotorisasi panggilan dari gateway saat AUTH_ENABLED. */
export async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!pathGatewayAman(path)) {
    return Response.json({ error: "path tidak sah" }, { status: 400 });
  }
  const headers = new Headers(init?.headers);
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc) headers.set("x-service-token", svc);
  const res = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", ...init, headers });
  // F58: aksi tulis yang BERHASIL = satu "action" pemakaian fitur. Fire-and-forget; import dinamis
  // supaya modul ini tetap ringan & tak menarik next/headers untuk panggilan GET.
  const method = (init?.method ?? "GET").toUpperCase();
  if (res.ok && method !== "GET" && method !== "HEAD") {
    void import("./adoption-record").then((m) => m.captureAction(method)).catch(() => {});
  }
  return res;
}

/** Teruskan respons backend sbg JSON dgn AMAN — tak pernah throw walau body
 * kosong / bukan JSON (mis. backend lama balas 404 teks). Mencegah BFF route
 * crash → klien dapat pesan jelas, bukan "Unexpected end of JSON input". */
export async function relay(res: Response): Promise<Response> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : { error: `backend ${res.status} (body kosong)` };
  } catch {
    body = { error: text.slice(0, 300) || `backend ${res.status}` };
  }
  return Response.json(body, { status: res.status });
}
