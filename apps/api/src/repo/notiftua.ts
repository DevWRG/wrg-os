import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// Notifikasi item TUA — port wrg-monitor/scripts/notif_tua.sh.
// Baca resume eksekutif terbaru (monitor_digest kind='resume') hari ini,
// ekstrak section "⏳ OUTSTANDING" yang ber-tag TUA (umur >4 jam), lalu kirim
// top-5 ke grup tujuan (NOTIF_TUA_TARGET). Idempotent via tabel notif_state:
// signature topic-only → skip bila set item sama dgn notif sebelumnya (anti-spam).

const STATE_KEY = "tua";

// WIB (UTC+7) — selaras dgn scheduler & monitor.
const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const wibDate = (): string => wibNow().toISOString().slice(0, 10);
const wibJam = (): string => wibNow().toISOString().slice(11, 16);

// Ekstrak baris item OUTSTANDING ber-tag TUA dari teks resume.
// Mirror awk legacy: capture dari header "⏳ OUTSTANDING" sampai section
// bernomor berikutnya / "Generated:" / garis "=====", lalu filter tag TUA.
export function extractTua(content: string): string[] {
  const lines = content.split(/\r?\n/);
  let capture = false;
  const block: string[] = [];
  for (const raw of lines) {
    if (/^\s*⏳\s*OUTSTANDING/.test(raw)) {
      capture = true;
      continue;
    }
    if (capture && (/^\s*\d+\.\s/.test(raw) || /^\s*Generated:/.test(raw) || /^\s*={3,}/.test(raw))) break;
    if (capture) block.push(raw);
  }
  // tag TUA = uppercase (template: "[TUA jika >4 jam]"); hindari "paling tua" (lowercase).
  return block
    .filter((l) => /TUA/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);
}

// Signature topic-only: buang bullet & segala setelah '|', sort-unik, sha256.
function signature(tua: string[]): string {
  const topics = Array.from(
    new Set(tua.map((l) => l.replace(/^•\s*/, "").replace(/\s*\|.*$/, "").trim())),
  ).sort();
  return createHash("sha256").update(topics.join("\n")).digest("hex");
}

function buildMessage(tua: string[], tanggal: string, jam: string): string {
  const count = tua.length;
  const top5 = tua.slice(0, 5).map((l) => (l.startsWith("•") ? l : `• ${l}`)).join("\n");
  let msg = `*🚨 ${count} Item TUA — Perlu Follow-Up*\n_${tanggal} ${jam} WIB | dari Resume Eksekutif_\n\n${top5}`;
  if (count > 5) msg += `\n\n_…+${count - 5} item lainnya. Lihat dashboard untuk lengkap:_`;
  else msg += `\n\n_Detail lengkap di dashboard:_`;
  const dash = process.env.NOTIF_TUA_DASHBOARD_URL || process.env.WEB_PUBLIC_URL || "";
  if (dash) msg += `\n${dash}`;
  return msg;
}

export interface NotifTuaResult {
  sent: boolean;
  count: number;
  skipped?: "no-target" | "no-resume" | "no-tua" | "anti-spam";
  dryRun?: boolean;
  to?: string;
  payload?: string;
}

export async function runNotifTua(opts: { dryRun?: boolean; target?: string } = {}): Promise<NotifTuaResult> {
  const target = opts.target || process.env.NOTIF_TUA_TARGET || "";
  if (!target) return { sent: false, count: 0, skipped: "no-target" };

  const sql = db();
  const tanggal = wibDate();
  const [row] = await sql`
    SELECT content FROM monitor_digest
    WHERE kind = 'resume' AND tanggal = ${tanggal}
    ORDER BY waktu DESC NULLS LAST, id DESC
    LIMIT 1
  `;
  if (!row) return { sent: false, count: 0, skipped: "no-resume" };

  const tua = extractTua(String(row.content));
  if (tua.length === 0) {
    // tidak ada item TUA → reset state (item sebelumnya dianggap selesai).
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, '', 0, now())
      ON CONFLICT (key) DO UPDATE SET signature = '', count = 0, sent_at = now()
    `;
    return { sent: false, count: 0, skipped: "no-tua" };
  }

  const sig = signature(tua);
  const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${STATE_KEY}`;
  if (!opts.dryRun && prev && String(prev.signature) === sig) {
    return { sent: false, count: tua.length, skipped: "anti-spam" };
  }

  const payload = buildMessage(tua, tanggal, wibJam());
  if (opts.dryRun) {
    return { sent: false, count: tua.length, dryRun: true, to: target, payload };
  }

  const g = await sendViaWaGateway(target, payload);
  if (g.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, ${sig}, ${tua.length}, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${sig}, count = ${tua.length}, sent_at = now()
    `;
  }
  return { sent: g.sent, count: tua.length, dryRun: Boolean(g.dryRun), to: target };
}
