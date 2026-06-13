#!/usr/bin/env node
// WA bridge — jembatan HOST antara wrg-os (container) dan openclaw (CLI + capture).
// Dua fungsi dalam satu proses:
//   1. SEND server: HTTP POST /send {to,message} → `openclaw message send` (CLI).
//      wrg-os api memanggil ini via WA_SEND_URL=http://host.docker.internal:PORT/send.
//   2. INBOUND forwarder: tail capture jsonl openclaw → POST ke /webhooks/wa wrg-os.
//
// Tanpa dependency npm (pakai modul bawaan Node). Jalan di HOST (butuh openclaw
// CLI + akses ~/.openclaw). Lihat README.md.
//
// ENV:
//   WA_BRIDGE_PORT          (default 18080)         port server /send
//   WA_BRIDGE_SECRET        ('' = tanpa auth)        cocokkan WA_SEND_SECRET wrg-os (header x-wa-secret)
//   WA_BRIDGE_SEND_LIVE     ('true' = kirim asli)    default false → log saja (dry-run host)
//   WA_CHANNEL              (default 'whatsapp')
//   OPENCLAW_BIN           (default 'openclaw')
//   WRG_WEBHOOK_URL         ('' = inbound OFF)        mis. http://localhost:4000/webhooks/wa
//   WRG_WEBHOOK_SECRET      ('')                      header x-wa-secret ke webhook
//   CAPTURE_DIR             (default ~/.openclaw/tmp/wrg-monitor/messages)
//   POLL_MS                 (default 4000)            interval tail inbound
//   OFFSET_FILE             (default ~/.wrg-wa-bridge-offsets.json)

import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.WA_BRIDGE_PORT || 18080);
const SECRET = process.env.WA_BRIDGE_SECRET || "";
const SEND_LIVE = (process.env.WA_BRIDGE_SEND_LIVE || "false").toLowerCase() === "true";
const CHANNEL = process.env.WA_CHANNEL || "whatsapp";
const OPENCLAW = process.env.OPENCLAW_BIN || "openclaw";
const WEBHOOK_URL = process.env.WRG_WEBHOOK_URL || "";
const WEBHOOK_SECRET = process.env.WRG_WEBHOOK_SECRET || "";
const CAPTURE_DIR = process.env.CAPTURE_DIR || join(homedir(), ".openclaw/tmp/wrg-monitor/messages");
const POLL_MS = Number(process.env.POLL_MS || 4000);
const OFFSET_FILE = process.env.OFFSET_FILE || join(homedir(), ".wrg-wa-bridge-offsets.json");

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── 1. SEND via openclaw CLI ─────────────────────────────────────────────
function openclawSend(to, message) {
  return new Promise((resolve) => {
    if (!SEND_LIVE) {
      log(`[send] DRY (WA_BRIDGE_SEND_LIVE!=true) → ${to}: ${String(message).slice(0, 80)}`);
      resolve({ sent: true, dryRun: true });
      return;
    }
    execFile(
      OPENCLAW,
      ["message", "send", "--channel", CHANNEL, "--target", String(to), "--message", String(message), "--json"],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          log(`[send] ERROR → ${to}: ${stderr || err.message}`);
          resolve({ sent: false, error: String(stderr || err.message).slice(0, 300) });
          return;
        }
        log(`[send] OK → ${to}`);
        resolve({ sent: true, output: String(stdout).slice(0, 300) });
      },
    );
  });
}

const server = http.createServer((req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "GET" && req.url === "/health") return reply(200, { ok: true, sendLive: SEND_LIVE, inbound: !!WEBHOOK_URL });
  if (req.method !== "POST" || !req.url.startsWith("/send")) return reply(404, { error: "not found" });
  if (SECRET && req.headers["x-wa-secret"] !== SECRET) return reply(401, { error: "unauthorized" });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let p;
    try {
      p = JSON.parse(body || "{}");
    } catch {
      return reply(400, { error: "invalid JSON" });
    }
    if (!p.to || !p.message) return reply(400, { error: "to & message wajib" });
    const r = await openclawSend(p.to, p.message);
    reply(r.sent ? 200 : 502, r);
  });
});
server.listen(PORT, "0.0.0.0", () => log(`[bridge] /send di :${PORT} (sendLive=${SEND_LIVE}, channel=${CHANNEL})`));

// ── 2. INBOUND forwarder: tail capture jsonl → POST /webhooks/wa ──────────
function loadOffsets() {
  try {
    return JSON.parse(readFileSync(OFFSET_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveOffsets(o) {
  try {
    writeFileSync(OFFSET_FILE, JSON.stringify(o));
  } catch (e) {
    log("[inbound] gagal simpan offset:", String(e));
  }
}
function todayDir() {
  const d = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB
  return join(CAPTURE_DIR, d);
}
async function postWebhook(rec) {
  const headers = { "content-type": "application/json" };
  if (WEBHOOK_SECRET) headers["x-wa-secret"] = WEBHOOK_SECRET;
  const r = await fetch(WEBHOOK_URL, { method: "POST", headers, body: JSON.stringify(rec) });
  if (!r.ok) throw new Error(`webhook ${r.status}`);
}

let offsets = loadOffsets();
let firstScan = true;
async function pollInbound() {
  const dir = todayDir();
  if (!existsSync(dir)) return;
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return;
  }
  for (const f of files) {
    const path = join(dir, f);
    let size;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    const prev = offsets[path] ?? null;
    // Scan pertama: set offset = EOF (jangan replay histori), kecuali file baru.
    if (prev === null) {
      offsets[path] = firstScan ? size : 0;
      if (firstScan) continue;
    }
    const from = offsets[path];
    if (size <= from) continue;
    let chunk = "";
    try {
      const fd = openSync(path, "r");
      const buf = Buffer.alloc(size - from);
      readSync(fd, buf, 0, buf.length, from);
      closeSync(fd);
      chunk = buf.toString("utf8");
    } catch (e) {
      log("[inbound] baca gagal", path, String(e));
      continue;
    }
    const lines = chunk.split("\n");
    let consumed = from;
    for (const line of lines) {
      const raw = line.trim();
      consumed += Buffer.byteLength(line) + 1;
      if (!raw) continue;
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch {
        continue;
      }
      if (rec.fromMe) continue; // jangan proses pesan keluar
      try {
        await postWebhook(rec); // format capture = OpenclawRecord (idempoten di wrg-os)
      } catch (e) {
        log("[inbound] forward gagal:", String(e));
        // jangan majukan offset jika gagal → retry lain kali
        offsets[path] = Math.min(consumed - Buffer.byteLength(line) - 1, size);
        saveOffsets(offsets);
        break;
      }
    }
    offsets[path] = Math.min(consumed, size);
    saveOffsets(offsets);
  }
  firstScan = false;
}

if (WEBHOOK_URL) {
  log(`[bridge] inbound forwarder → ${WEBHOOK_URL} (poll ${POLL_MS}ms, dir ${CAPTURE_DIR})`);
  setInterval(() => {
    pollInbound().catch((e) => log("[inbound] poll error:", String(e)));
  }, POLL_MS);
} else {
  log("[bridge] inbound forwarder OFF (set WRG_WEBHOOK_URL untuk aktif)");
}
