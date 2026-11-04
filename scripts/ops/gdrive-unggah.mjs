#!/usr/bin/env node
// Unggah SATU berkas besar ke Google Drive (resumable, per potongan) + retensi folder.
// Dipakai backup-harian.sh (cadangan database terenkripsi). Kredensial = OAuth yang sama
// dengan brosur F130 (GDRIVE_OAUTH_FILE, lihat apps/api/src/gdrive.ts & gdrive-oauth.mjs);
// unggah multipart di gdrive.ts hanya cocok untuk berkas kecil (≤5 MB), dump ±100 MB.
//
//   node scripts/ops/gdrive-unggah.mjs unggah <berkas> [--folder <id>] [--nama-folder "<nama>"]
//   node scripts/ops/gdrive-unggah.mjs retensi --awalan <prefix> --hari <n> [--folder <id>] [--nama-folder "<nama>"]
//   node scripts/ops/gdrive-unggah.mjs folder [--nama-folder "<nama>"]   → cetak id folder (buat bila belum ada)
//
// Env: GDRIVE_OAUTH_FILE (wajib), GDRIVE_BACKUP_FOLDER_ID (opsional; kalau kosong folder
// dicari/dibuat menurut nama di root My Drive akun OAuth). Keluaran: satu baris JSON di stdout.
import { readFile, stat, open } from "node:fs/promises";
import { basename } from "node:path";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const POTONG = 32 * 1024 * 1024; // kelipatan 256 KiB, syarat resumable Drive

const args = process.argv.slice(2);
const perintah = args[0];
const opsi = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const gagal = (pesan) => { console.log(JSON.stringify({ ok: false, error: pesan })); process.exit(1); };

async function token() {
  const f = process.env.GDRIVE_OAUTH_FILE?.trim();
  if (!f) gagal("GDRIVE_OAUTH_FILE kosong");
  let k;
  try { k = JSON.parse(await readFile(f, "utf8")); } catch { gagal("kredensial OAuth tak terbaca"); }
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: k.client_id, client_secret: k.client_secret, refresh_token: k.refresh_token }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) gagal(`login Google Drive gagal: ${d.error_description ?? d.error ?? res.status}`);
  return d.access_token;
}

async function api(tok, path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.headers ?? {}) } });
  const d = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) gagal(`Drive ${init.method ?? "GET"} ${path.split("?")[0]}: ${d.error?.message ?? res.status}`);
  return d;
}

const kutip = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function folderId(tok) {
  const id = opsi("--folder") ?? process.env.GDRIVE_BACKUP_FOLDER_ID?.trim();
  if (id) return id;
  const nama = opsi("--nama-folder") ?? "WRG-OS Cadangan Database";
  const q = `name = '${kutip(nama)}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`;
  const d = await api(tok, `/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=2`);
  if (d.files?.length) return d.files[0].id;
  const baru = await api(tok, "/files?fields=id", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: nama, mimeType: "application/vnd.google-apps.folder" }),
  });
  return baru.id;
}

async function unggah(tok, berkas, folder) {
  const ukuran = (await stat(berkas)).size;
  const mulai = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size", {
    method: "POST",
    headers: {
      authorization: `Bearer ${tok}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "application/octet-stream",
      "x-upload-content-length": String(ukuran),
    },
    body: JSON.stringify({ name: basename(berkas), parents: [folder] }),
  });
  const sesi = mulai.headers.get("location");
  if (!mulai.ok || !sesi) gagal(`sesi unggah ditolak: ${mulai.status}`);
  const fh = await open(berkas, "r");
  try {
    let posisi = 0;
    for (;;) {
      const n = Math.min(POTONG, ukuran - posisi);
      const buf = Buffer.alloc(n);
      await fh.read(buf, 0, n, posisi);
      const res = await fetch(sesi, {
        method: "PUT",
        headers: { "content-length": String(n), "content-range": `bytes ${posisi}-${posisi + n - 1}/${ukuran}` },
        body: buf,
      });
      if (res.status === 308) {
        const r = res.headers.get("range");
        posisi = r ? Number(r.split("-")[1]) + 1 : 0;
        continue;
      }
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.id) gagal(`unggah gagal di byte ${posisi}: ${d.error?.message ?? res.status}`);
      if (Number(d.size) !== ukuran) gagal(`ukuran di Drive ${d.size} ≠ lokal ${ukuran}`);
      return { id: d.id, ukuran };
    }
  } finally {
    await fh.close();
  }
}

async function retensi(tok, folder, awalan, hari) {
  if (!awalan || !(hari > 0)) gagal("retensi butuh --awalan dan --hari > 0");
  const batas = new Date(Date.now() - hari * 86_400_000).toISOString();
  const q = `'${kutip(folder)}' in parents and name contains '${kutip(awalan)}' and createdTime < '${batas}' and trashed = false`;
  const d = await api(tok, `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=200`);
  const lama = (d.files ?? []).filter((f) => f.name.startsWith(awalan));
  for (const f of lama) {
    await api(tok, `/files/${f.id}?fields=id`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
  }
  return lama.map((f) => f.name);
}

const tok = await token();
const folder = await folderId(tok);
if (perintah === "folder") {
  console.log(JSON.stringify({ ok: true, folder }));
} else if (perintah === "unggah") {
  const berkas = args[1];
  if (!berkas || berkas.startsWith("--")) gagal("unggah butuh path berkas");
  const r = await unggah(tok, berkas, folder);
  console.log(JSON.stringify({ ok: true, folder, ...r }));
} else if (perintah === "retensi") {
  const dibuang = await retensi(tok, folder, opsi("--awalan"), Number(opsi("--hari")));
  console.log(JSON.stringify({ ok: true, folder, dibuang }));
} else {
  gagal("perintah: unggah | retensi | folder");
}
