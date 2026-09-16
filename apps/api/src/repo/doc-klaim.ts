import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { db } from "../db.js";
import { callAi, aiDryRun } from "../ai.js";
import { normalizeWa } from "./master.js";

// DOC #KLAIM — klaim reimburse dana karyawan (kebutuhan kantor/perjalanan
// dinas, beli pakai uang sendiri lalu klaim disertai bukti nota). Ingestion
// HANYA via WA #KLAIM+foto (reuse wa_message.media_path, lihat inbound.ts).
// Approval generik — siapa pun user login boleh decide, tak ada role-gate
// baru (Owner blueprint kosong, tak ada rule resmi soal approver).

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();
const toIsoTsOrNull = (x: unknown): string | null => (x == null ? null : toIsoTs(x));

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function mimeFromPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/jpeg";
}

// JID individu WA ("628xxx@s.whatsapp.net") -> nomor mentah. Pola sama
// jidNumber() di master.ts (tidak diexport dari sana, duplikasi 1-liner).
function jidNumber(jid: string | null | undefined): string {
  if (!jid) return "";
  return String(jid).split("@")[0].split(":")[0];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface DocKlaimRow {
  id: string;
  wa_message_id: string | null;
  sender_name: string | null;
  employee_id: string | null;
  employee_nama: string | null;
  media_path: string | null;
  caption: string | null;
  raw_text: string | null;
  nomor_dokumen: string | null;
  tanggal_dokumen: string | null;
  nominal: string | null;
  pihak: string | null;
  model_used: string | null;
  ocr_dry_run: boolean;
  kategori: string | null;
  status: string;
  decided_by_name: string | null;
  decided_at: string | null;
  nominal_disetujui: number | null;
  dibayar_at: string | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
}

function mapKlaimRow(r: Record<string, unknown>): DocKlaimRow {
  return {
    id: String(r.id),
    wa_message_id: r.wa_message_id ? String(r.wa_message_id) : null,
    sender_name: r.sender_name ? String(r.sender_name) : null,
    employee_id: r.employee_id ? String(r.employee_id) : null,
    employee_nama: r.employee_nama ? String(r.employee_nama) : null,
    media_path: r.media_path ? String(r.media_path) : null,
    caption: r.caption ? String(r.caption) : null,
    raw_text: r.raw_text ? String(r.raw_text) : null,
    nomor_dokumen: r.nomor_dokumen ? String(r.nomor_dokumen) : null,
    tanggal_dokumen: r.tanggal_dokumen ? String(r.tanggal_dokumen) : null,
    nominal: r.nominal ? String(r.nominal) : null,
    pihak: r.pihak ? String(r.pihak) : null,
    model_used: r.model_used ? String(r.model_used) : null,
    ocr_dry_run: Boolean(r.ocr_dry_run),
    kategori: r.kategori ? String(r.kategori) : null,
    status: String(r.status),
    decided_by_name: r.decided_by_name ? String(r.decided_by_name) : null,
    decided_at: toIsoTsOrNull(r.decided_at),
    nominal_disetujui: r.nominal_disetujui == null ? null : Number(r.nominal_disetujui),
    dibayar_at: toIsoTsOrNull(r.dibayar_at),
    catatan: r.catatan ? String(r.catatan) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function listKlaim(status?: string): Promise<DocKlaimRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT k.*, e.nama AS employee_nama, u.name AS decided_by_name
    FROM doc_klaim k
    LEFT JOIN employee e ON e.id = k.employee_id
    LEFT JOIN app_user u ON u.id = k.decided_by_user_id
    WHERE ${status ? sql`k.status = ${status}` : sql`true`}
    ORDER BY k.created_at DESC
  `;
  return rows.map(mapKlaimRow);
}

export async function getKlaim(id: string): Promise<DocKlaimRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT k.*, e.nama AS employee_nama, u.name AS decided_by_name
    FROM doc_klaim k
    LEFT JOIN employee e ON e.id = k.employee_id
    LEFT JOIN app_user u ON u.id = k.decided_by_user_id
    WHERE k.id = ${id}
  `;
  return rows.length ? mapKlaimRow(rows[0]) : null;
}

// Resolve pengirim WA -> employee, pola sama resolveAmByWa() (master.ts)
// tapi target employee.whatsapp bukan master_user.wa_number. NULL kalau tak
// ke-resolve — klaim TETAP tercatat, tidak di-reject (bukan semua pengirim
// wajib ada di roster employee_spine).
export async function resolveEmployeeByWa(senderJid: string | null): Promise<string | null> {
  const norm = normalizeWa(jidNumber(senderJid));
  if (!norm) return null;
  const sql = db();
  const rows = await sql`
    SELECT id FROM employee WHERE regexp_replace(COALESCE(whatsapp, ''), '[^0-9]', '', 'g') = ${norm} LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

// Input manual via web (dipakai buat coba tanpa harus kirim WA sungguhan) —
// TANPA OCR, semua field diketik langsung. model_used='manual' membedakan
// dari hasil Gemini Vision (ocr_dry_run tetap false, bukan "OCR gagal", ini
// memang tak pernah lewat OCR sama sekali).
export interface CreateKlaimManualInput {
  employee_id?: string | null;
  sender_name?: string | null;
  nomor_dokumen?: string | null;
  tanggal_dokumen?: string | null;
  nominal?: string | null;
  pihak?: string | null;
  kategori?: string | null;
  catatan?: string | null;
}

export async function createKlaimManual(input: CreateKlaimManualInput): Promise<DocKlaimRow | ActionResult> {
  if (input.kategori && !["kebutuhan_kantor", "perjalanan_dinas", "lainnya"].includes(input.kategori)) {
    return { ok: false, error: "kategori tidak valid" };
  }
  const sql = db();
  if (input.employee_id) {
    const [emp] = await sql`SELECT 1 FROM employee WHERE id = ${input.employee_id}`;
    if (!emp) return { ok: false, error: "employee_id tidak ditemukan" };
  }
  const rows = await sql`
    INSERT INTO doc_klaim (employee_id, sender_name, nomor_dokumen, tanggal_dokumen, nominal, pihak, kategori, catatan, model_used, ocr_dry_run)
    VALUES (
      ${input.employee_id ?? null}, ${input.sender_name ?? null}, ${input.nomor_dokumen ?? null},
      ${input.tanggal_dokumen ?? null}, ${input.nominal ?? null}, ${input.pihak ?? null},
      ${input.kategori ?? null}, ${input.catatan ?? null}, 'manual', false
    )
    RETURNING id
  `;
  return (await getKlaim(String(rows[0].id))) as DocKlaimRow;
}

export async function deleteKlaim(id: string): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM doc_klaim WHERE id = ${id}`;
  if (!row) return { ok: false, error: "klaim tidak ditemukan" };
  if (row.status === "dibayar") {
    return { ok: false, error: "klaim sudah dibayar — tidak bisa dihapus" };
  }
  await sql`DELETE FROM doc_klaim WHERE id = ${id}`;
  return { ok: true };
}

export async function updateKategori(id: string, kategori: string | null): Promise<DocKlaimRow | ActionResult> {
  if (kategori && !["kebutuhan_kantor", "perjalanan_dinas", "lainnya"].includes(kategori)) {
    return { ok: false, error: "kategori tidak valid" };
  }
  const sql = db();
  const rows = await sql`UPDATE doc_klaim SET kategori = ${kategori}, updated_at = now() WHERE id = ${id} RETURNING id`;
  if (!rows.length) return { ok: false, error: "klaim tidak ditemukan" };
  return (await getKlaim(id)) as DocKlaimRow;
}

// ── Approval — forward-only: baru -> disetujui|ditolak -> dibayar ──
const TRANSITIONS: Record<string, string[]> = {
  baru: ["disetujui", "ditolak"],
  disetujui: ["dibayar"],
  ditolak: [],
  dibayar: [],
};

export interface DecideKlaimInput {
  decision: "disetujui" | "ditolak";
  nominal_disetujui?: number | null;
  catatan?: string | null;
  decided_by_user_id?: string | null;
}

export async function decideKlaim(id: string, input: DecideKlaimInput): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM doc_klaim WHERE id = ${id}`;
  if (!row) return { ok: false, error: "klaim tidak ditemukan" };
  const fromStatus = String(row.status);
  if (!(TRANSITIONS[fromStatus] ?? []).includes(input.decision)) {
    return { ok: false, error: `transisi "${fromStatus}" -> "${input.decision}" tidak diizinkan` };
  }
  if (
    input.decision === "disetujui" &&
    input.nominal_disetujui != null &&
    (!Number.isFinite(input.nominal_disetujui) || input.nominal_disetujui < 0)
  ) {
    return { ok: false, error: "nominal_disetujui tidak boleh negatif" };
  }
  const nominalDisetujui = input.decision === "disetujui" ? (input.nominal_disetujui ?? null) : null;
  await sql`
    UPDATE doc_klaim SET
      status = ${input.decision}, decided_by_user_id = ${input.decided_by_user_id ?? null}, decided_at = now(),
      nominal_disetujui = ${nominalDisetujui}, catatan = ${input.catatan ?? null}, updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

export async function markDibayar(id: string): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status FROM doc_klaim WHERE id = ${id}`;
  if (!row) return { ok: false, error: "klaim tidak ditemukan" };
  if (!(TRANSITIONS[String(row.status)] ?? []).includes("dibayar")) {
    return { ok: false, error: `transisi "${row.status}" -> "dibayar" tidak diizinkan` };
  }
  await sql`UPDATE doc_klaim SET status = 'dibayar', dibayar_at = now(), updated_at = now() WHERE id = ${id}`;
  return { ok: true };
}

// Dipanggil dari inbound.ts saat #KLAIM + foto terdeteksi. Baca file dari
// media_path (didownload wa-bridge sebelum masuk DB, pola sama photoFollowup),
// kirim ke services/ai /ocr-klaim, simpan hasil apa adanya (termasuk kalau
// dry-run — TIDAK ada fabrikasi data).
export async function ingestKlaim(opts: {
  wa_message_id: string;
  sender_jid: string | null;
  sender_name: string | null;
  media_path: string;
  caption: string | null;
}): Promise<DocKlaimRow | ActionResult> {
  const sql = db();

  let imageBase64: string;
  try {
    imageBase64 = (await readFile(opts.media_path)).toString("base64");
  } catch (e) {
    return { ok: false, error: `gagal baca file foto: ${(e as Error).message}` };
  }

  const [employeeId, { status, data }] = await Promise.all([
    resolveEmployeeByWa(opts.sender_jid),
    callAi("/ocr-klaim", {
      image_base64: imageBase64,
      mime_type: mimeFromPath(opts.media_path),
      caption: opts.caption,
      dry_run: aiDryRun(),
    }),
  ]);
  if (status >= 400) {
    return { ok: false, error: `services/ai /ocr-klaim status ${status}: ${JSON.stringify(data)}` };
  }

  const rows = await sql`
    INSERT INTO doc_klaim (
      wa_message_id, sender_name, employee_id, media_path, caption,
      raw_text, nomor_dokumen, tanggal_dokumen, nominal, pihak, model_used, ocr_dry_run
    ) VALUES (
      ${opts.wa_message_id}, ${opts.sender_name}, ${employeeId}, ${opts.media_path}, ${opts.caption},
      ${(data.raw_text as string) || null}, ${(data.nomor_dokumen as string) ?? null},
      ${(data.tanggal_dokumen as string) ?? null}, ${(data.nominal as string) ?? null},
      ${(data.pihak as string) ?? null}, ${(data.model as string) ?? null}, ${Boolean(data.dry_run)}
    )
    RETURNING id
  `;
  return (await getKlaim(String(rows[0].id))) as DocKlaimRow;
}
