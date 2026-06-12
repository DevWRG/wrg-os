// Adapter pengiriman keluar ke gateway WA (openclaw).
//
// Tiga mode (chokepoint tunggal untuk semua kirim WA wrg-os):
//   1. STUB    — WA_SEND_URL kosong → tidak ada gateway (dev). sent:true, stub:true.
//   2. DRY-RUN — WA_SEND_URL di-set TAPI WA_DRY_RUN != "false" → gateway terwiring
//                tapi TIDAK kirim live (di-log saja). sent:true, dryRun:true.
//                Ini default aman: set URL dulu, kirim live belakangan.
//   3. LIVE    — WA_SEND_URL di-set DAN WA_DRY_RUN="false" → POST {to,message} ke
//                gateway (opsional header x-wa-secret = WA_SEND_SECRET).
//
// WA_TEST_TARGET (opsional): bila di-set, SEMUA tujuan dialihkan ke nomor/jid ini
// (uji live aman ke nomor sendiri sebelum broadcast ke grup nyata).
//
// Catatan: dry-run sengaja mengembalikan sent:true (no-op sukses) agar alur caller
// normal — sama seperti stub. Jejak mode ada di field stub/dryRun + to (terlog).

export interface WaSendResult {
  sent: boolean;
  stub: boolean;
  dryRun?: boolean;
  status?: number;
  error?: string;
  to?: string;
}

function isDryRun(): boolean {
  // default: dry-run AKTIF (aman). Hanya live bila eksplisit "false".
  return (process.env.WA_DRY_RUN ?? "true").toLowerCase() !== "false";
}

export async function sendViaWaGateway(to: string, body: string): Promise<WaSendResult> {
  const url = process.env.WA_SEND_URL;
  const testTarget = process.env.WA_TEST_TARGET?.trim();
  const target = testTarget || to;

  // Mode 1: belum terwiring
  if (!url) return { sent: true, stub: true, to: target };

  // Mode 2: terwiring tapi tidak kirim live
  if (isDryRun()) {
    console.log(`[wa] DRY-RUN (WA_DRY_RUN) — tidak kirim live → ${target}: ${body.slice(0, 80)}`);
    return { sent: true, stub: false, dryRun: true, to: target };
  }

  // Mode 3: live
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.WA_SEND_SECRET) headers["x-wa-secret"] = process.env.WA_SEND_SECRET;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to: target, message: body }),
    });
    if (!res.ok) {
      return { sent: false, stub: false, status: res.status, error: (await res.text()).slice(0, 200), to: target };
    }
    return { sent: true, stub: false, status: res.status, to: target };
  } catch (e) {
    return { sent: false, stub: false, error: String(e), to: target };
  }
}

export interface WaPreflight {
  mode: "stub" | "dry-run" | "live";
  configured: boolean;
  dryRun: boolean;
  secretSet: boolean;
  testTarget: string | null;
  reachable?: boolean;
  status?: number;
  error?: string;
}

// Cek kesiapan wiring TANPA kirim pesan. Bila probe=true & URL di-set, lakukan
// GET ringan ke gateway (timeout 3s) sekadar konfirmasi konektivitas/DNS.
export async function waPreflight(probe = false): Promise<WaPreflight> {
  const url = process.env.WA_SEND_URL;
  const configured = !!url;
  const dryRun = isDryRun();
  const base: WaPreflight = {
    mode: !configured ? "stub" : dryRun ? "dry-run" : "live",
    configured,
    dryRun,
    secretSet: !!process.env.WA_SEND_SECRET,
    testTarget: process.env.WA_TEST_TARGET?.trim() || null,
  };
  if (!configured || !probe) return base;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    clearTimeout(t);
    return { ...base, reachable: true, status: res.status }; // dapat respons HTTP = reachable
  } catch (e) {
    return { ...base, reachable: false, error: String(e) };
  }
}
