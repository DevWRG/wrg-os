// Server-only gateway helper. apps/web bertindak sebagai API gateway (BFF):
// browser memanggil /api/* di origin yang sama, lalu server meneruskan ke
// backend domain (apps/api, Hono). Pakai env server `API_URL` — JANGAN
// NEXT_PUBLIC_* di sini supaya base URL backend tidak ter-expose ke browser.

export function apiBaseUrl(): string {
  // Default: port @wrg/api (4000, sama di lokal & docker). Override via API_URL.
  return process.env.API_URL ?? "http://localhost:4000";
}

/** Fetch ke backend domain dengan base URL tergabung + no-store.
 * BFF tepercaya: sertakan x-service-token (API_SERVICE_TOKEN) bila di-set,
 * supaya apps/api mengotorisasi panggilan dari gateway saat AUTH_ENABLED. */
export function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const svc = process.env.API_SERVICE_TOKEN;
  if (svc) headers.set("x-service-token", svc);
  return fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", ...init, headers });
}
