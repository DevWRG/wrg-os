import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { db } from "../db.js";

// Nama grup WA (subject) HANYA tersimpan di state openclaw (sessions.json), bukan
// di wa_message (sender/group_name selalu kosong di capture). Util ini baca
// subject grup dari sessions.json buat melabeli grup di dashboard (mis. galeri
// Pola) tanpa input manual.

const sessionsFile = (): string =>
  process.env.OPENCLAW_SESSIONS_FILE || join(homedir(), ".openclaw/agents/main/sessions/sessions.json");

// { "<jid>@g.us": "Nama Grup" } dari field subject di sessions.json.
export function loadGroupSubjects(): Record<string, string> {
  const map: Record<string, string> = {};
  let root: unknown;
  try {
    root = JSON.parse(readFileSync(sessionsFile(), "utf8"));
  } catch {
    return map; // file tak ada / tak terbaca → kosong (no-op)
  }
  const walk = (o: unknown, key: string) => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const subject = rec.subject;
    if (typeof subject === "string" && subject.trim()) {
      const m = key.match(/group:(\S+@g\.us)/);
      const jid = m ? m[1] : typeof rec.jid === "string" ? rec.jid : "";
      if (jid.endsWith("@g.us")) map[jid] = subject.trim();
    }
    for (const k in rec) walk(rec[k], k);
  };
  walk(root, "");
  return map;
}

// Backfill monitor_pola.group_name dari subject sessions.json untuk grup yg
// namanya masih kosong/JID. Return jumlah baris ter-update.
export async function syncGroupNamesFromSessions(): Promise<number> {
  const subjects = loadGroupSubjects();
  const jids = Object.keys(subjects);
  if (jids.length === 0) return 0;
  const sql = db();
  let updated = 0;
  for (const jid of jids) {
    const r = await sql`
      UPDATE monitor_pola SET group_name = ${subjects[jid]}
      WHERE group_jid = ${jid} AND (group_name IS NULL OR group_name = '' OR group_name LIKE '%@g.us')
    `;
    updated += r.count ?? 0;
  }
  return updated;
}
