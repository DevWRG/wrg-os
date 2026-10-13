// Google Drive lewat service account — TANPA library googleapis: JWT RS256
// ditandatangani dengan node:crypto, lalu REST Drive v3 lewat fetch.
//
// Dipakai F130 (brosur diunggah dari dashboard, file disimpan di Google Drive —
// keputusan user 13 Okt 2026). Dua mode kredensial (server, bukan repo — repo PUBLIC):
//   • OAuth akun Workspace (DIPAKAI — info@, file masuk My Drive akun itu):
//       GDRIVE_OAUTH_FILE = path JSON {client_id, client_secret, refresh_token}
//       (chmod 600), dibuat sekali lewat scripts/ops/gdrive-oauth.mjs.
//       Jalur ini dipilih karena organisasi memblokir kunci service account
//       (iam.disableServiceAccountKeyCreation, "secure by default").
//   • Service account (cadangan): GDRIVE_SA_KEY_FILE = kunci JSON; folder harus
//       di Shared Drive (service account tak punya kuota My Drive).
//   GDRIVE_BROSUR_FOLDER_ID = id folder tujuan (wajib, kedua mode).
// Tanpa kredensial/folder → driveSiap() false dan unggah ditolak dengan pesan jelas.

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

interface KunciSa { client_email: string; private_key: string; token_uri?: string }

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";

export const driveSiap = (): boolean =>
  Boolean((process.env.GDRIVE_OAUTH_FILE?.trim() || process.env.GDRIVE_SA_KEY_FILE?.trim()) && process.env.GDRIVE_BROSUR_FOLDER_ID?.trim());

interface KredOauth { client_id: string; client_secret: string; refresh_token: string }

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Murni: JWT assertion service account (RS256), berlaku 1 jam. */
export function bangunJwt(k: KunciSa, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: k.client_email, scope: SCOPE, aud: k.token_uri ?? TOKEN_URI, iat: nowSec, exp: nowSec + 3600 }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${head}.${claim}`);
  return `${head}.${claim}.${b64url(sign.sign(k.private_key))}`;
}

/** Murni: badan multipart/related (metadata JSON + isi file) untuk upload Drive. */
export function bangunMultipart(meta: Record<string, unknown>, isi: Buffer, mime: string, boundary: string): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    isi,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
}

let tokenCache: { token: string; habis: number } | null = null;

async function tukarToken(body: URLSearchParams, uri = TOKEN_URI): Promise<string> {
  const res = await fetch(uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const d = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !d.access_token) {
    // invalid_grant = token dicabut / akun berubah sandi → jalankan ulang gdrive-oauth.mjs
    throw new DriveError(502, `login Google Drive gagal: ${d.error_description ?? d.error ?? res.status}${d.error === "invalid_grant" ? " — sambungkan ulang akun Drive (scripts/ops/gdrive-oauth.mjs)" : ""}`);
  }
  tokenCache = { token: d.access_token, habis: Date.now() + (d.expires_in ?? 3600) * 1000 };
  return d.access_token;
}

async function tokenAkses(): Promise<string> {
  if (tokenCache && tokenCache.habis > Date.now() + 60_000) return tokenCache.token;
  const oauth = process.env.GDRIVE_OAUTH_FILE?.trim();
  if (oauth) {
    let k: KredOauth;
    try { k = JSON.parse(await readFile(oauth, "utf8")) as KredOauth; }
    catch { throw new DriveError(503, "kredensial OAuth Google Drive tak terbaca di server"); }
    if (!k.client_id || !k.client_secret || !k.refresh_token) throw new DriveError(503, "kredensial OAuth Google Drive tidak lengkap");
    return tukarToken(new URLSearchParams({ grant_type: "refresh_token", client_id: k.client_id, client_secret: k.client_secret, refresh_token: k.refresh_token }));
  }
  const path = process.env.GDRIVE_SA_KEY_FILE?.trim();
  if (!path) throw new DriveError(503, "Google Drive belum dikonfigurasi (GDRIVE_OAUTH_FILE / GDRIVE_SA_KEY_FILE)");
  let k: KunciSa;
  try { k = JSON.parse(await readFile(path, "utf8")) as KunciSa; }
  catch { throw new DriveError(503, "kunci service account Google Drive tak terbaca di server"); }
  return tukarToken(new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: bangunJwt(k, Math.floor(Date.now() / 1000)) }), k.token_uri ?? TOKEN_URI);
}

/** Unggah file ke folder brosur; balikan id + tautan lihat. */
export async function unggahKeDrive(isi: Buffer, nama: string, mime: string): Promise<{ id: string; webViewLink: string }> {
  if (!driveSiap()) throw new DriveError(503, "Google Drive belum dikonfigurasi di server — hubungi admin");
  const token = await tokenAkses();
  const boundary = `wrgos${Date.now().toString(36)}`;
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(bangunMultipart({ name: nama, parents: [process.env.GDRIVE_BROSUR_FOLDER_ID!.trim()] }, isi, mime, boundary)),
  });
  const d = (await res.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!res.ok || !d.id) throw new DriveError(502, `unggah ke Google Drive gagal: ${d.error?.message ?? res.status}`);
  return { id: d.id, webViewLink: d.webViewLink ?? `https://drive.google.com/file/d/${d.id}/view` };
}

/** Buka file untuk "siapa pun dengan tautan" (lihat saja). false = ditolak kebijakan Workspace. */
export async function bukaUntukPublik(fileId: string): Promise<boolean> {
  const token = await tokenAkses();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    console.error("[gdrive] set publik gagal:", res.status, d.error?.message);
    return false;
  }
  return true;
}
