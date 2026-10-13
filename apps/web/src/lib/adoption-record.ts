// Pengirim event pemakaian fitur (F58) ke apps/api. Server-only.
// Aturan: TIDAK PERNAH mengganggu request user — semua kegagalan ditelan (DB mati, migrasi 212
// belum ada, apps/api lambat) dan identitas hanya dari cookie sesi yang tanda tangannya sah.

import { cookies, headers } from "next/headers";

import { SESSION_COOKIE } from "@/app/api/auth/login/route";
import { actionFeatureFor } from "./adoption-capture";
import { apiBaseUrl } from "./gateway";
import { sessionTokenSub } from "./session-token";

const TIMEOUT_MS = 3000;

/** Kirim satu event. `userId` sudah terverifikasi oleh pemanggil. */
export async function sendUsageEvent(userId: string, featureKey: string, kind: "view" | "action"): Promise<void> {
  try {
    const h: Record<string, string> = { "content-type": "application/json", "x-user-id": userId };
    const svc = process.env.API_SERVICE_TOKEN;
    if (svc) h["x-service-token"] = svc;
    // fetch mentah (bukan gatewayFetch): pencatat tak boleh memicu pencatat.
    await fetch(`${apiBaseUrl()}/adoption/event`, {
      method: "POST", headers: h, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ feature_key: featureKey, kind }),
    });
  } catch {
    /* senyap */
  }
}

/** Dipanggil gatewayFetch setelah request tulis BERHASIL. Konteks request (cookie/header) diambil
 * dari Next; di luar konteks request (skrip, tes) cookies() melempar → tidak mencatat. */
export async function captureAction(method: string): Promise<void> {
  try {
    const pathname = (await headers()).get("x-pathname");
    const key = actionFeatureFor(pathname, method);
    if (!key) return;
    const uid = await sessionTokenSub((await cookies()).get(SESSION_COOKIE)?.value);
    if (!uid) return;
    await sendUsageEvent(uid, key, "action");
  } catch {
    /* senyap */
  }
}
