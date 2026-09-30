import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

import { db } from "../db.js";

// Nama grup WA (subject) HANYA tersimpan di state openclaw — wa_message.group_name
// selalu kosong di capture (0 terisi dari 41.853 baris prod). Util ini membaca
// subject grup dari state itu buat melabeli grup di dashboard (galeri Pola,
// penamaan grup Sales Analytics) tanpa input manual.
//
// DUA bentuk state, dicoba berurutan:
//   1. SQLite  agents/<id>/agent/openclaw-agent.sqlite  — openclaw >= 2026.9.5
//   2. JSON    agents/<id>/sessions/sessions.json       — instalasi lama
//
// Kenapa dua: update openclaw 2026.9.5 (21 Sep 2026) memindahkan store sesi ke
// SQLite dan mengarsipkan sessions.json. Pembacaan JSON lalu mengembalikan map
// kosong TANPA suara, dan semua kartu grup yang namanya belum pernah ter-backfill
// ke monitor_pola.group_name berubah jadi JID angka. Tak ada yang gagal — layarnya
// tetap tampil wajar, cuma tanpa nama. Karena itu map kosong sekarang DILAPORKAN
// (lihat warnSumberMati), bukan diam.

const sessionsFile = (): string =>
  process.env.OPENCLAW_SESSIONS_FILE || join(homedir(), ".openclaw/agents/main/sessions/sessions.json");

const agentSqliteFile = (): string =>
  process.env.OPENCLAW_AGENT_SQLITE || join(homedir(), ".openclaw/agents/main/agent/openclaw-agent.sqlite");

type SumberStatus = "ok" | "tak-ada" | "tak-didukung";

// Kunci sesi grup berbentuk "agent:main:whatsapp:group:<jid>@g.us".
const jidDariKunci = (key: string): string => {
  const m = key.match(/group:(\S+?@g\.us)/);
  return m ? m[1] : "";
};

// openclaw >= 2026.9.5: subject ada di kolom entry_json (root $.subject) pada
// tabel session_nodes. Dibaca read-only — file ini milik proses openclaw.
function subjectsDariSqlite(): { map: Record<string, string>; status: SumberStatus } {
  const map: Record<string, string> = {};
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
  } catch {
    // Node < 23 tanpa --experimental-sqlite (CI masih Node 22) → bukan error,
    // cuma sumber ini tak tersedia; jalur JSON di bawah yang dipakai.
    return { map, status: "tak-didukung" };
  }
  let handle: InstanceType<typeof DatabaseSync>;
  try {
    handle = new DatabaseSync(agentSqliteFile(), { readOnly: true });
  } catch {
    return { map, status: "tak-ada" };
  }
  try {
    const rows = handle
      .prepare(
        `SELECT session_key AS k, json_extract(entry_json, '$.subject') AS subject
           FROM session_nodes
          WHERE session_key LIKE '%@g.us'`,
      )
      .all() as Array<{ k?: unknown; subject?: unknown }>;
    for (const r of rows) {
      const jid = jidDariKunci(String(r.k ?? ""));
      const subject = typeof r.subject === "string" ? r.subject.trim() : "";
      if (jid && subject) map[jid] = subject;
    }
  } catch {
    // Skema openclaw berubah lagi (tabel/kolom lain) → perlakukan seperti sumber
    // mati supaya jatuh ke JSON dan tetap dilaporkan.
    return { map: {}, status: "tak-ada" };
  } finally {
    handle.close();
  }
  return { map, status: "ok" };
}

// { "<jid>@g.us": "Nama Grup" } dari field subject di sessions.json (openclaw lama).
function subjectsDariJson(): { map: Record<string, string>; status: SumberStatus } {
  const map: Record<string, string> = {};
  let root: unknown;
  try {
    root = JSON.parse(readFileSync(sessionsFile(), "utf8"));
  } catch {
    return { map, status: "tak-ada" }; // file tak ada / tak terbaca
  }
  const walk = (o: unknown, key: string) => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    const subject = rec.subject;
    if (typeof subject === "string" && subject.trim()) {
      const jid = jidDariKunci(key) || (typeof rec.jid === "string" ? rec.jid : "");
      if (jid.endsWith("@g.us")) map[jid] = subject.trim();
    }
    for (const k in rec) walk(rec[k], k);
  };
  walk(root, "");
  return { map, status: "ok" };
}

// Kartu tanpa nama adalah kerusakan yang tak pernah melempar error, jadi satu-satunya
// jalan untuk ketahuan adalah lapor sendiri. Di-throttle supaya tak membanjiri log:
// listWaGroups dipanggil tiap render dashboard.
let warnTerakhir = 0;
const WARN_JEDA_MS = 10 * 60 * 1000;

function warnSumberMati(sqlite: SumberStatus, json: SumberStatus): void {
  const now = Date.now();
  if (now - warnTerakhir < WARN_JEDA_MS) return;
  warnTerakhir = now;
  console.warn(
    `[group-names] subject openclaw tak terbaca — nama grup akan tampil sebagai JID angka. ` +
      `sqlite=${sqlite} (${agentSqliteFile()}) json=${json} (${sessionsFile()})`,
  );
}

export function loadGroupSubjects(): Record<string, string> {
  const dariSqlite = subjectsDariSqlite();
  const dariJson = subjectsDariJson();
  // SQLite menang: instalasi yang sudah bermigrasi masih menyimpan sessions.json
  // lama di arsip, dan isinya bisa basi.
  const map = { ...dariJson.map, ...dariSqlite.map };
  if (Object.keys(map).length === 0) warnSumberMati(dariSqlite.status, dariJson.status);
  return map;
}

// Backfill monitor_pola.group_name dari subject openclaw untuk grup yg namanya
// masih kosong/JID. Return jumlah baris ter-update.
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
