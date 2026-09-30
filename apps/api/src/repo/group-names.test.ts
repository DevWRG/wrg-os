// Tes `loadGroupSubjects` — satu-satunya sumber nama grup WA di dashboard.
//
// Kenapa diuji: kerusakan di sini TIDAK melempar error. Openclaw 2026.9.5
// (21 Sep 2026) memindahkan store sesi dari sessions.json ke SQLite; pembaca
// lama mengembalikan map kosong tanpa suara dan 10 kartu grup di galeri Pola
// berubah jadi JID angka. Layarnya tetap tampil wajar. Jadi yang dijaga di sini
// bukan cuma "nama terbaca", tapi juga "sumber mati BERSUARA".
//
// Bentuk fixture diambil dari state openclaw prod 2026-09-24:
//   session_key = "agent:main:whatsapp:group:<jid>@g.us"
//   entry_json  = {"subject":"<nama grup>", ...}  (subject di root)

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadGroupSubjects } from "./group-names.js";

const tmp = () => mkdtempSync(join(tmpdir(), "group-names-"));

// node:sqlite perlu --experimental-sqlite di Node 22 (versi CI). Kalau tak ada,
// jalur SQLite memang tak bisa diuji di sini — tapi jalur JSON & peringatan tetap.
const sqliteTersedia = (() => {
  try {
    createRequire(import.meta.url)("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

const bersihkanEnv = () => {
  delete process.env.OPENCLAW_AGENT_SQLITE;
  delete process.env.OPENCLAW_SESSIONS_FILE;
};

const tangkapWarn = async (fn: () => void): Promise<string[]> => {
  const asli = console.warn;
  const pesan: string[] = [];
  console.warn = (...a: unknown[]) => { pesan.push(a.join(" ")); };
  try { fn(); } finally { console.warn = asli; }
  return pesan;
};

test("SQLite openclaw: subject dibaca dari session_nodes", { skip: !sqliteTersedia }, () => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const file = join(tmp(), "openclaw-agent.sqlite");
  const dbh = new DatabaseSync(file);
  dbh.exec("CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)");
  const ins = dbh.prepare("INSERT INTO session_nodes (session_key, entry_json) VALUES (?, ?)");
  ins.run("agent:main:whatsapp:group:120363042496232833@g.us", JSON.stringify({ subject: "ADMIN PENJ., GUDANG & KEU" }));
  ins.run("agent:main:whatsapp:group:120363048384809457@g.us", JSON.stringify({ subject: "Accounting & Purchasing WRG" }));
  // Chat personal — bukan grup, tak boleh ikut.
  ins.run("agent:main:whatsapp:dm:6281234567890@s.whatsapp.net", JSON.stringify({ subject: "Budi" }));
  // Subject kosong → jangan dipetakan (kalau ikut, kartunya bernama string kosong).
  ins.run("agent:main:whatsapp:group:120363404278850337@g.us", JSON.stringify({ subject: "   " }));
  dbh.close();

  bersihkanEnv();
  process.env.OPENCLAW_AGENT_SQLITE = file;
  process.env.OPENCLAW_SESSIONS_FILE = join(tmp(), "tak-ada.json");

  const subjects = loadGroupSubjects();
  assert.equal(subjects["120363042496232833@g.us"], "ADMIN PENJ., GUDANG & KEU");
  assert.equal(subjects["120363048384809457@g.us"], "Accounting & Purchasing WRG");
  assert.equal(Object.keys(subjects).length, 2);
  bersihkanEnv();
});

test("SQLite menang atas sessions.json yang tertinggal di arsip", { skip: !sqliteTersedia }, () => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const dir = tmp();
  const file = join(dir, "openclaw-agent.sqlite");
  const dbh = new DatabaseSync(file);
  dbh.exec("CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, entry_json TEXT NOT NULL)");
  dbh.prepare("INSERT INTO session_nodes (session_key, entry_json) VALUES (?, ?)")
    .run("agent:main:whatsapp:group:6281335118687-1527497998@g.us", JSON.stringify({ subject: "PENJUALAN SOLO-JOGJA-PWT" }));
  dbh.close();

  const json = join(dir, "sessions.json");
  writeFileSync(json, JSON.stringify({
    "group:6281335118687-1527497998@g.us": { subject: "GROUP TRAINING KRM-TAGIH" },
    "group:120363427279299767@g.us": { subject: "Hanya ada di JSON" },
  }));

  bersihkanEnv();
  process.env.OPENCLAW_AGENT_SQLITE = file;
  process.env.OPENCLAW_SESSIONS_FILE = json;

  const subjects = loadGroupSubjects();
  // Nama basi di JSON kalah (kasus nyata yang bikin dua kartu kembar di galeri).
  assert.equal(subjects["6281335118687-1527497998@g.us"], "PENJUALAN SOLO-JOGJA-PWT");
  // Grup yang hanya ada di JSON tetap terbawa — instalasi campuran tak kehilangan nama.
  assert.equal(subjects["120363427279299767@g.us"], "Hanya ada di JSON");
  bersihkanEnv();
});

test("sessions.json dipakai kalau SQLite tak ada (instalasi openclaw lama)", () => {
  const dir = tmp();
  const json = join(dir, "sessions.json");
  writeFileSync(json, JSON.stringify({
    agents: { "group:120363405660957801@g.us": { subject: "Wahana - Snibe" } },
  }));

  bersihkanEnv();
  process.env.OPENCLAW_AGENT_SQLITE = join(dir, "tak-ada.sqlite");
  process.env.OPENCLAW_SESSIONS_FILE = json;

  assert.equal(loadGroupSubjects()["120363405660957801@g.us"], "Wahana - Snibe");
  bersihkanEnv();
});

test("dua sumber mati → map kosong TAPI bersuara (bukan gagal senyap)", async () => {
  const dir = tmp();
  bersihkanEnv();
  process.env.OPENCLAW_AGENT_SQLITE = join(dir, "tak-ada.sqlite");
  process.env.OPENCLAW_SESSIONS_FILE = join(dir, "tak-ada.json");

  let subjects: Record<string, string> = { belum: "diisi" };
  const pesan = await tangkapWarn(() => { subjects = loadGroupSubjects(); });

  assert.deepEqual(subjects, {});
  assert.equal(pesan.length, 1, "map kosong wajib dilaporkan sekali");
  assert.match(pesan[0], /group-names/);
  assert.match(pesan[0], /JID angka/);

  // Throttle: panggilan berikutnya dalam jendela yang sama tak boleh membanjiri
  // log (listWaGroups dipanggil tiap render dashboard).
  const lagi = await tangkapWarn(() => { loadGroupSubjects(); });
  assert.equal(lagi.length, 0);
  bersihkanEnv();
});
