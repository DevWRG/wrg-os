// Server-only gateway helper. apps/web bertindak sebagai API gateway (BFF):
// browser memanggil /api/* di origin yang sama, lalu server meneruskan ke
// backend domain (apps/api, Hono). Pakai env server `API_URL` — JANGAN
// NEXT_PUBLIC_* di sini supaya base URL backend tidak ter-expose ke browser.

export function apiBaseUrl(): string {
  // Default: port dev @wrg/api (8092). Di docker set API_URL=http://api:4000.
  return process.env.API_URL ?? "http://localhost:8092";
}

/** Fetch ke backend domain dengan base URL tergabung + no-store. */
export function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", ...init });
}
