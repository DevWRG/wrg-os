// Adapter pengiriman keluar ke gateway WA (openclaw). Bila WA_SEND_URL di-set,
// POST {to, message} ke sana (opsional header x-wa-secret = WA_SEND_SECRET).
// Bila tidak di-set → stub sukses (dev), supaya siklus kirim bisa diuji tanpa
// gateway nyata. Pola sama dengan integrasi inbound WA & OpenRouter.

export interface WaSendResult {
  sent: boolean;
  stub: boolean;
  status?: number;
  error?: string;
}

export async function sendViaWaGateway(to: string, body: string): Promise<WaSendResult> {
  const url = process.env.WA_SEND_URL;
  if (!url) return { sent: true, stub: true };
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.WA_SEND_SECRET) headers["x-wa-secret"] = process.env.WA_SEND_SECRET;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, message: body }),
    });
    if (!res.ok) {
      return { sent: false, stub: false, status: res.status, error: (await res.text()).slice(0, 200) };
    }
    return { sent: true, stub: false, status: res.status };
  } catch (e) {
    return { sent: false, stub: false, error: String(e) };
  }
}
