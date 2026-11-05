import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { db } from "../db.js";
import { callAi, aiDryRun } from "../ai.js";
import { normalizeWa } from "./master.js";

// DOC #KLAIM — klaim reimburse dana karyawan (kebutuhan kantor/perjalanan
// dinas, beli pakai uang sendiri lalu klaim disertai bukti nota). Ingestion
// HANYA via WA #KLAIM+foto (reuse wa_message.media_path, lihat inbound.ts).
// Approval: setujui/tolak = HoD pengaju (atau Direktur/admin), tandai dibayar
// = Finance (grup finance-hod). Pengaju tak boleh memutus/membayar klaimnya
// sendiri. Pengirim #KLAIM wajib karyawan terdaftar (roster) — keputusan user
// 15 Okt 2026, menggantikan "approval generik siapa pun user login".

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
  dibayar_by_name: string | null;
  am_id: string | null;
  hod_key: string | null;
  hod_nama: string | null;
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
    dibayar_by_name: r.dibayar_by_name ? String(r.dibayar_by_name) : null,
    am_id: r.am_id ? String(r.am_id) : null,
    hod_key: r.hod_key ? String(r.hod_key) : null,
    hod_nama: r.hod_nama ? String(r.hod_nama) : null,
    catatan: r.catatan ? String(r.catatan) : null,
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function listKlaim(status?: string): Promise<DocKlaimRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT k.*, e.nama AS employee_nama, u.name AS decided_by_name,
           ub.name AS dibayar_by_name, h.nama AS hod_nama
    FROM doc_klaim k
    LEFT JOIN employee e ON e.id = k.employee_id
    LEFT JOIN app_user u ON u.id = k.decided_by_user_id
    LEFT JOIN app_user ub ON ub.id = k.dibayar_by_user_id
    LEFT JOIN master_hod h ON h.hod_key = k.hod_key
    WHERE ${status ? sql`k.status = ${status}` : sql`true`}
    ORDER BY k.created_at DESC
  `;
  return rows.map(mapKlaimRow);
}

export async function getKlaim(id: string): Promise<DocKlaimRow | null> {
  const sql = db();
  const rows = await sql`
    SELECT k.*, e.nama AS employee_nama, u.name AS decided_by_name,
           ub.name AS dibayar_by_name, h.nama AS hod_nama
    FROM doc_klaim k
    LEFT JOIN employee e ON e.id = k.employee_id
    LEFT JOIN app_user u ON u.id = k.decided_by_user_id
    LEFT JOIN app_user ub ON ub.id = k.dibayar_by_user_id
    LEFT JOIN master_hod h ON h.hod_key = k.hod_key
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

// Pengaju #KLAIM = karyawan terdaftar (keputusan user 15 Okt 2026). Roster
// dikenali lewat resolveSender ketat (pemanggil, inbound.ts) — di GRUP nomor
// pengirim tak tersedia (sender_jid = JID grup), jadi resolveEmployeeByWa
// saja tak pernah cocok untuk pesan grup. Dari am_id roster → baris employee
// (jembatan employee.am_id, pola getPengajuProfile overtime) → HoD-nya.
export interface PengajuKlaim {
  am_id: string;
  employee_id: string | null;
  hod_key: string | null;
}

export async function pengajuDariAmId(amId: string, senderJid: string | null): Promise<PengajuKlaim> {
  const sql = db();
  const [e] = await sql`
    SELECT id, hod_key FROM employee WHERE am_id = ${amId} ORDER BY created_at LIMIT 1
  `;
  if (e) return { am_id: amId, employee_id: String(e.id), hod_key: e.hod_key ? String(e.hod_key) : null };
  // Belum tertaut lewat am_id — coba nomor WA (hanya berhasil di chat pribadi).
  const empId = await resolveEmployeeByWa(senderJid);
  if (!empId) return { am_id: amId, employee_id: null, hod_key: null };
  const [e2] = await sql`SELECT hod_key FROM employee WHERE id = ${empId}`;
  return { am_id: amId, employee_id: empId, hod_key: e2?.hod_key ? String(e2.hod_key) : null };
}

// Input manual via web (dipakai buat coba tanpa harus kirim WA sungguhan) —
// TANPA OCR, semua field diketik langsung. model_used='manual' membedakan
// dari hasil OCR (ocr_dry_run tetap false, bukan "OCR gagal", ini
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
  // Klaim selalu punya pengaju yang jelas — HoD-nya yang berwenang memutus.
  if (!input.employee_id) return { ok: false, error: "karyawan pengaju wajib dipilih" };
  const [emp] = await sql`SELECT am_id, hod_key FROM employee WHERE id = ${input.employee_id}`;
  if (!emp) return { ok: false, error: "employee_id tidak ditemukan" };
  if (!input.nominal || parseNominalRupiah(input.nominal) == null) {
    return { ok: false, error: "nominal wajib diisi angka (mis. 150000 atau Rp 150.000)" };
  }
  const rows = await sql`
    INSERT INTO doc_klaim (employee_id, am_id, hod_key, sender_name, nomor_dokumen, tanggal_dokumen, nominal, pihak, kategori, catatan, model_used, ocr_dry_run)
    VALUES (
      ${input.employee_id}, ${emp.am_id ?? null}, ${emp.hod_key ?? null}, ${input.sender_name ?? null}, ${input.nomor_dokumen ?? null},
      ${input.tanggal_dokumen ?? null}, ${input.nominal}, ${input.pihak ?? null},
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
  // Hanya klaim yang belum diputuskan yang boleh dihapus (mis. kiriman dobel).
  // Klaim disetujui/ditolak/dibayar = jejak keputusan uang — tak boleh hilang.
  if (row.status !== "baru") {
    return { ok: false, error: `klaim berstatus "${row.status}" — tidak bisa dihapus` };
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
// Wewenang (keputusan user 15 Okt 2026): setujui/tolak = HoD pengaju (atau
// direktur/admin); tandai dibayar = grup Finance (atau admin); pengaju tak
// boleh memutus/membayar klaimnya sendiri.
const TRANSITIONS: Record<string, string[]> = {
  baru: ["disetujui", "ditolak"],
  disetujui: ["dibayar"],
  ditolak: [],
  dibayar: [],
};

// Batas kewajaran satu klaim reimburse — di atas ini bukan "beli kebutuhan
// kantor pakai uang sendiri" lagi, dan hampir pasti salah ketik.
export const NOMINAL_KLAIM_MAKS = 100_000_000;

export interface AktorKlaim {
  userId: string | null;
  amId: string | null;
  hodKey: string | null;
  role: string | null;
  superuser: boolean;
  finance: boolean; // anggota grup akses 'finance-hod'
}

const istimewa = (a: AktorKlaim): boolean =>
  a.superuser || a.role === "admin" || a.role === "direktur";

// Pure — diuji unit. null = boleh, string = alasan ditolak.
export function alasanTolakPutus(k: { am_id: string | null; hod_key: string | null }, a: AktorKlaim): string | null {
  if (a.amId && k.am_id && a.amId === k.am_id) return "Tidak boleh memutus klaim sendiri.";
  if (istimewa(a)) return null;
  if (!k.hod_key) return "HoD pengaju tak tercatat — klaim ini diputus Direktur/admin.";
  if (a.hodKey && a.hodKey === k.hod_key) return null;
  return "Hanya HoD pengaju (atau Direktur/admin) yang boleh menyetujui/menolak klaim ini.";
}

export function alasanTolakBayar(k: { am_id: string | null }, a: AktorKlaim): string | null {
  if (a.amId && k.am_id && a.amId === k.am_id) return "Tidak boleh menandai bayar klaim sendiri.";
  if (a.finance || a.superuser || a.role === "admin") return null;
  return "Hanya Finance (grup finance-hod) yang boleh menandai klaim dibayar.";
}

// Nominal di nota/OCR berupa teks ("Rp 150.000", "10,000", "Rp150.000,00").
// Pure — diuji unit. null = tak bisa dibaca yakin (bukan ditebak).
export function parseNominalRupiah(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let t = String(raw).replace(/rp\.?|idr/gi, "").replace(/\s+/g, "").replace(/[.,]-$/, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  // Desimal 2 digit di ujung ("150.000,00" / "150,000.00") dibuang.
  t = t.replace(/[.,]\d{2}$/, "");
  // Sisa pemisah = pemisah ribuan (titik ala ID atau koma ala struk EN).
  const parts = t.split(/[.,]/);
  if (parts.length > 1 && !parts.slice(1).every((p) => p.length === 3)) return null;
  const n = Number(parts.join(""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DecideKlaimInput {
  decision: "disetujui" | "ditolak";
  nominal_disetujui?: number | null;
  catatan?: string | null;
}

export async function decideKlaim(id: string, input: DecideKlaimInput, aktor: AktorKlaim): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status, am_id, hod_key, nominal FROM doc_klaim WHERE id = ${id}`;
  if (!row) return { ok: false, error: "klaim tidak ditemukan" };
  const fromStatus = String(row.status);
  if (!(TRANSITIONS[fromStatus] ?? []).includes(input.decision)) {
    return { ok: false, error: `transisi "${fromStatus}" -> "${input.decision}" tidak diizinkan` };
  }
  const tolak = alasanTolakPutus({ am_id: row.am_id ?? null, hod_key: row.hod_key ?? null }, aktor);
  if (tolak) return { ok: false, error: tolak };
  let nominalDisetujui: number | null = null;
  if (input.decision === "disetujui") {
    const nota = parseNominalRupiah(row.nominal as string | null);
    const diminta = input.nominal_disetujui == null ? nota : Number(input.nominal_disetujui);
    if (diminta == null) return { ok: false, error: "nominal nota tak terbaca — isi nominal disetujui" };
    if (!Number.isFinite(diminta) || diminta <= 0) return { ok: false, error: "nominal disetujui harus angka > 0" };
    if (diminta > NOMINAL_KLAIM_MAKS) return { ok: false, error: "nominal disetujui melebihi batas Rp 100.000.000" };
    if (nota != null && diminta > nota) return { ok: false, error: "nominal disetujui melebihi nominal nota" };
    nominalDisetujui = diminta;
  }
  const upd = await sql`
    UPDATE doc_klaim SET
      status = ${input.decision}, decided_by_user_id = ${aktor.userId}, decided_at = now(),
      nominal_disetujui = ${nominalDisetujui}, catatan = ${input.catatan ?? null}, updated_at = now()
    WHERE id = ${id} AND status = ${fromStatus}
    RETURNING id
  `;
  if (!upd.length) return { ok: false, error: "status klaim berubah — muat ulang halaman" };
  return { ok: true };
}

export async function markDibayar(id: string, aktor: AktorKlaim): Promise<ActionResult> {
  const sql = db();
  const [row] = await sql`SELECT status, am_id FROM doc_klaim WHERE id = ${id}`;
  if (!row) return { ok: false, error: "klaim tidak ditemukan" };
  if (!(TRANSITIONS[String(row.status)] ?? []).includes("dibayar")) {
    return { ok: false, error: `transisi "${row.status}" -> "dibayar" tidak diizinkan` };
  }
  const tolak = alasanTolakBayar({ am_id: row.am_id ?? null }, aktor);
  if (tolak) return { ok: false, error: tolak };
  const upd = await sql`
    UPDATE doc_klaim SET status = 'dibayar', dibayar_at = now(), dibayar_by_user_id = ${aktor.userId}, updated_at = now()
    WHERE id = ${id} AND status = 'disetujui'
    RETURNING id
  `;
  if (!upd.length) return { ok: false, error: "status klaim berubah — muat ulang halaman" };
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
  pengaju: PengajuKlaim;
}): Promise<DocKlaimRow | ActionResult> {
  const sql = db();

  let imageBase64: string;
  try {
    imageBase64 = (await readFile(opts.media_path)).toString("base64");
  } catch (e) {
    console.error("[klaim] gagal baca file foto:", opts.media_path, (e as Error).message);
    return { ok: false, error: "gagal baca file foto, coba kirim ulang fotonya" };
  }

  const employeeId = opts.pengaju.employee_id;
  const [{ status, data }] = await Promise.all([
    // izinkanTemplate: SATU-SATUNYA pengecualian dari aturan "hasil terdegradasi
    // = error" di callAi, dan disengaja.
    //
    // Di sini hasil OCR yang gagal BUKAN teks palsu yang bisa tersimpan sebagai
    // fakta: services/ai balas semua field kosong, barisnya tetap masuk dengan
    // `model_used='dry-run-fallback'` + `ocr_dry_run`, dan pengirimnya dibalas
    // "foto tersimpan, OCR belum aktif — ditindaklanjuti manual". Itu degradasi
    // yang jujur dan tidak kehilangan apa pun.
    //
    // Kalau ikut ditolak jadi 503, ingestKlaim balik `ok:false` → TAK ADA baris
    // doc_klaim yang ditulis, padahal baris WA-nya tetap ditandai processed.
    // Klaimnya hilang — persis kelas kegagalan yang diperingatkan catatan
    // panjang di ai.ts.
    callAi(
      "/ocr-klaim",
      {
        image_base64: imageBase64,
        mime_type: mimeFromPath(opts.media_path),
        caption: opts.caption,
        dry_run: aiDryRun(),
      },
      { izinkanTemplate: true },
    ),
  ]);
  // services/ai tak terjangkau / error → callAi balas 503 (izinkanTemplate hanya
  // menutup kasus AI hidup tapi terdegradasi). Dulu langsung ok:false: klaimnya
  // HILANG (baris WA sudah ditandai processed) dan teks error internal dibalas ke
  // pengirim (uji dev 12 Okt 2026). Sekarang fotonya tetap dicatat sebagai
  // dry-run — sama jujurnya dengan jalur template di atas.
  const ocr: Record<string, unknown> =
    status >= 400 ? { model: "ai-tak-terjangkau", dry_run: true } : data;
  if (status >= 400) {
    console.error(`[klaim] services/ai /ocr-klaim status ${status} — foto disimpan tanpa OCR:`, JSON.stringify(data).slice(0, 200));
  }

  const rows = await sql`
    INSERT INTO doc_klaim (
      wa_message_id, sender_name, employee_id, am_id, hod_key, media_path, caption,
      raw_text, nomor_dokumen, tanggal_dokumen, nominal, pihak, model_used, ocr_dry_run
    ) VALUES (
      ${opts.wa_message_id}, ${opts.sender_name}, ${employeeId}, ${opts.pengaju.am_id}, ${opts.pengaju.hod_key},
      ${opts.media_path}, ${opts.caption},
      ${(ocr.raw_text as string) || null}, ${(ocr.nomor_dokumen as string) ?? null},
      ${(ocr.tanggal_dokumen as string) ?? null}, ${(ocr.nominal as string) ?? null},
      ${(ocr.pihak as string) ?? null}, ${(ocr.model as string) ?? null}, ${Boolean(ocr.dry_run)}
    )
    RETURNING id
  `;
  return (await getKlaim(String(rows[0].id))) as DocKlaimRow;
}
