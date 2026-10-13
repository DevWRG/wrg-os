#!/usr/bin/env node
// Sambungkan akun Google Workspace (mis. info@wahanalifeline.co.id) ke WRG-OS
// untuk unggah brosur F130 ke Google Drive — SEKALI JALAN, di LAPTOP (butuh
// browser untuk login). Dipakai karena organisasi memblokir kunci service
// account (iam.disableServiceAccountKeyCreation).
//
//   node scripts/ops/gdrive-oauth.mjs <client_secret_xxx.json> [--akun info@wahanalifeline.co.id] [--folder <id>] [--keluar <path>]
//
// <client_secret_xxx.json> = unduhan OAuth client tipe "Desktop app" dari
// Google Cloud Console. Skrip membuka halaman login Google (PKCE + state),
// menerima kode lewat 127.0.0.1, menukarnya jadi refresh token, lalu MENULIS
// {client_id, client_secret, refresh_token} ke berkas chmod 600
// (default ~/.wrg-os/secrets/gdrive-oauth.json). Token TIDAK PERNAH dicetak.
// Sesudahnya: salin berkas itu ke Mac mini & isi GDRIVE_OAUTH_FILE di .env.prod.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const SCOPE = "https://www.googleapis.com/auth/drive";
const args = process.argv.slice(2);
const opsi = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const berkasClient = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!berkasClient) {
  console.error("Pakai: node scripts/ops/gdrive-oauth.mjs <client_secret_xxx.json> [--akun email] [--folder id] [--keluar path]");
  process.exit(2);
}
const keluar = resolve(opsi("--keluar") ?? `${homedir()}/.wrg-os/secrets/gdrive-oauth.json`);
const akun = opsi("--akun");
const folder = opsi("--folder");

const raw = JSON.parse(await readFile(resolve(berkasClient), "utf8"));
const c = raw.installed ?? raw.web;
if (!c?.client_id || !c?.client_secret) {
  console.error("Berkas client tidak dikenali — unduh JSON dari OAuth client tipe \"Desktop app\".");
  process.exit(2);
}
const tokenUri = c.token_uri ?? "https://oauth2.googleapis.com/token";
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const hasil = await new Promise((selesai, gagal) => {
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/") { res.writeHead(404).end(); return; }
    const tutup = (kode, pesan) => {
      res.writeHead(kode, { "content-type": "text/html; charset=utf-8" });
      res.end(`<p style="font-family:sans-serif">${pesan}</p>`);
    };
    if (u.searchParams.get("state") !== state) { tutup(400, "State tidak cocok — ulangi dari terminal."); return; }
    if (u.searchParams.get("error")) { tutup(400, `Dibatalkan: ${u.searchParams.get("error")}`); srv.close(); gagal(new Error(u.searchParams.get("error"))); return; }
    const code = u.searchParams.get("code");
    if (!code) { tutup(400, "Kode tidak ada."); return; }
    try {
      const r = await fetch(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }),
      });
      const d = await r.json();
      if (!r.ok || !d.refresh_token) throw new Error(d.error_description ?? d.error ?? "refresh token tidak diberikan");
      tutup(200, "✅ Akun Google Drive tersambung ke WRG-OS. Tab ini boleh ditutup.");
      srv.close();
      selesai(d);
    } catch (e) {
      tutup(500, `Gagal menukar kode: ${e.message}`);
      srv.close();
      gagal(e);
    }
  });
  let redirect = "";
  srv.listen(0, "127.0.0.1", () => {
    redirect = `http://127.0.0.1:${srv.address().port}/`;
    const q = new URLSearchParams({
      client_id: c.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state,
      ...(akun ? { login_hint: akun } : {}),
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    console.log(`\nBuka (otomatis dicoba) lalu login${akun ? ` sebagai ${akun}` : ""}:\n${url}\n`);
    spawn("open", [url], { stdio: "ignore", detached: true }).on("error", () => {});
  });
  setTimeout(() => { srv.close(); gagal(new Error("waktu habis (5 menit)")); }, 5 * 60_000).unref();
});

// Cek akun yang tersambung (+ folder tujuan bila diberikan) — tanpa mencetak token.
const auth = { authorization: `Bearer ${hasil.access_token}` };
const about = await (await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", { headers: auth })).json();
const email = about?.user?.emailAddress ?? "(tak diketahui)";
console.log(`Akun tersambung: ${email}`);
if (akun && email.toLowerCase() !== akun.toLowerCase()) {
  console.error(`⚠️  Bukan ${akun} — berkas TIDAK ditulis. Ulangi dan login dengan akun yang benar.`);
  process.exit(1);
}
if (folder) {
  const f = await (await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: auth })).json();
  if (f.error) console.error(`⚠️  Folder ${folder} tak bisa dibuka akun ini: ${f.error.message}`);
  else console.log(`Folder tujuan: "${f.name}" · bisa diisi: ${f.capabilities?.canAddChildren ? "ya" : "TIDAK"}`);
}

await mkdir(dirname(keluar), { recursive: true, mode: 0o700 });
await writeFile(keluar, JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: hasil.refresh_token, akun: email, dibuat: new Date().toISOString() }, null, 2), { mode: 0o600 });
await chmod(keluar, 0o600);
console.log(`✅ Kredensial ditulis ke ${keluar} (chmod 600). Token tidak ditampilkan.`);
