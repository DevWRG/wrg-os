import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// notif_quota — port wrg-monitor/scripts/notif_quota.sh (versi proaktif wrg-os).
// Legacy: baca error.log untuk 403/quota lalu alert. wrg-os: probe OpenRouter
// /api/v1/key langsung (api punya OPENROUTER_API_KEY) → alert owner WA kalau key
// DITOLAK (401/403) atau limit (hampir) habis. Anti-spam via notif_state (key
// 'quota'), cooldown default 4 jam. Target = NOTIF_QUOTA_TARGET (default owner).

const STATE_KEY = "quota";
const OWNER_DEFAULT = "+6285733048855";
const COOLDOWN_MS = 4 * 3600 * 1000;

export interface NotifQuotaResult {
  ok: boolean; alerted: boolean; reason?: string; skipped?: "no-key" | "healthy" | "cooldown"; detail?: string;
}

export async function runNotifQuota(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<NotifQuotaResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, alerted: false, skipped: "no-key", reason: "OPENROUTER_API_KEY tak di-set" };

  // Probe status key + limit ke OpenRouter.
  let reason = "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      reason = `OpenRouter menolak key (HTTP ${res.status}) — cek/rotate OPENROUTER_API_KEY`;
    } else if (!res.ok) {
      reason = `OpenRouter /key HTTP ${res.status}`;
    } else {
      const j = (await res.json()) as { data?: { limit_remaining?: number | null; usage?: number; limit?: number | null; label?: string } };
      const rem = j.data?.limit_remaining;
      const minRem = Number(process.env.NOTIF_QUOTA_MIN_REMAINING ?? "0");
      if (rem !== null && rem !== undefined && rem <= minRem) {
        reason = `Limit OpenRouter (hampir) habis — limit_remaining=${rem} (usage=${j.data?.usage ?? "?"}, limit=${j.data?.limit ?? "?"})`;
      }
    }
  } catch (e) {
    reason = `Gagal probe OpenRouter /key: ${String(e).slice(0, 120)}`;
  }

  if (!reason) return { ok: true, alerted: false, skipped: "healthy" };

  // Anti-spam: cooldown sejak alert terakhir (kecuali force/dry-run).
  const sql = db();
  const [prev] = await sql`SELECT sent_at FROM notif_state WHERE key = ${STATE_KEY}`;
  if (!opts.force && !opts.dryRun && prev?.sent_at) {
    const age = Date.now() - new Date(prev.sent_at).getTime();
    if (age < COOLDOWN_MS) return { ok: false, alerted: false, skipped: "cooldown", reason, detail: `cooldown ${Math.round((COOLDOWN_MS - age) / 60000)} mnt lagi` };
  }

  const target = process.env.NOTIF_QUOTA_TARGET || OWNER_DEFAULT;
  const body = `⚠️ *WRG — OpenRouter bermasalah*\n${reason}\n\nFitur AI (rekap/resume/summary/briefing/leave/competitor) bakal fallback ke template sampai diperbaiki.`;

  if (opts.dryRun) return { ok: false, alerted: false, reason, detail: `would send to ${target}` };

  const g = await sendViaWaGateway(target, body);
  if (g.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, ${reason.slice(0, 200)}, 1, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${reason.slice(0, 200)}, count = notif_state.count + 1, sent_at = now()
    `;
  }
  return { ok: false, alerted: g.sent, reason };
}
