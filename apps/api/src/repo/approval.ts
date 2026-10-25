// F11 — Approval Engine KANONIK (migrasi 153 → 190 → 247).
//
// Satu mesin untuk semua approval: tiap ALUR (approval_alur.jenis) punya
// urutan tahapnya sendiri di approval_chain_config. Alur 'pengadaan' = chain
// asli F11 (HoD Sales → HoD Bisnis → HoD After Sales → HoD Supply Chain →
// Direktur). Modul lain (dana ops, maintenance GA, doc-klaim, …) menjadi
// KONSUMEN: membuat request dengan ref_tabel/ref_id ke baris induknya, lalu
// mendaftarkan penangan (daftarKonsumen) yang dijalankan di transaksi yang
// sama saat request disetujui/ditolak/dibatalkan.
//
// Tahap berjalan SEKUENSIAL; notifikasi WA PRIVAT per tahap, tahap berikut
// baru dikirim setelah tahap sekarang approve. Keputusan bisa lewat WA
// (#APPROVE/#REJECT <kode>) atau dashboard — aturannya SAMA (cekWewenang),
// termasuk larangan memutuskan permintaan sendiri. Target kontak diresolve
// LIVE dari app_user tiap kirim, bukan disnapshot, supaya perubahan nomor WA
// langsung kepakai tanpa migrasi/redeploy.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { TransactionSql } from "postgres";

import { db, isDbEnabled } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { normalizeWa } from "./master.js";

type Tx = TransactionSql<Record<string, unknown>>;

// Lampiran PDF/PNG (arahan user, susulan setelah base engine) — disk lokal,
// pola sama filosofi MEDIA_ROOT di index.ts (WA bridge media) tapi
// direktori TERPISAH krn sumbernya beda (upload browser, bukan WA).
const APPROVAL_UPLOAD_ROOT = resolve(process.env.APPROVAL_UPLOAD_ROOT ?? `${homedir()}/.wrg-os/approval-uploads`);
const ALLOWED_MIME = new Set(["application/pdf", "image/png"]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB/file — cukup utk PDF/PNG dokumen, cegah abuse

export const JENIS_BAWAAN = "pengadaan";

// Tahap yang orangnya "tergantung" (#1071, migrasi 190): routing memilih
// atribut request yang dipakai, hod_key_map memetakan nilai atribut → hod_key.
export type Routing = "tetap" | "wilayah" | "kategori";
export const WILAYAH = ["east", "west"] as const;
export const KATEGORI = ["IVD", "Medical"] as const;
export type Wilayah = (typeof WILAYAH)[number];
export type Kategori = (typeof KATEGORI)[number];

// hod = hod_key slot/peta · direktur = role direktur · hod_pengaju = hod_key
// yang dibawa request · grup = anggota access_group (migrasi 247).
export type TargetType = "hod" | "direktur" | "hod_pengaju" | "grup";
export const TARGET_TYPES: readonly TargetType[] = ["hod", "direktur", "hod_pengaju", "grup"];

export function isWilayah(v: unknown): v is Wilayah {
  return typeof v === "string" && (WILAYAH as readonly string[]).includes(v);
}
export function isKategori(v: unknown): v is Kategori {
  return typeof v === "string" && (KATEGORI as readonly string[]).includes(v);
}
function toTargetType(v: unknown): TargetType {
  return (TARGET_TYPES as readonly unknown[]).includes(v) ? (v as TargetType) : "hod";
}

export interface ChainConfigRow {
  jenis: string;
  urutan: number;
  label: string;
  targetType: TargetType;
  hodKey: string | null;
  groupKey: string | null;
  aktif: boolean;
  waNumberOverride: string | null;
  catatan: string | null;
  routing: Routing;
  hodKeyMap: Record<string, string> | null;
}

// Nilai sah per routing — dipakai validasi PATCH peta & tampilan config.
export function nilaiRouting(routing: Routing): readonly string[] {
  return routing === "wilayah" ? WILAYAH : routing === "kategori" ? KATEGORI : [];
}

export type PilihanHod = { hodKey: string | null } | { kurang: "wilayah" | "kategori" };

// Pure — dites terpisah tanpa DB. Menentukan hod_key sebuah tahap untuk satu
// request. `kurang` = tahap ini diarahkan per atribut, tapi request tak
// membawa atribut itu (beda dari peta yang belum punya entri untuk nilainya,
// yang = belum dikonfigurasi → hodKey null).
export function pilihHodKey(
  cfg: { routing: Routing; hodKey: string | null; hodKeyMap: Record<string, string> | null },
  req: { wilayah: string | null; kategori: string | null },
): PilihanHod {
  if (cfg.routing === "tetap") return { hodKey: cfg.hodKey };
  const nilai = cfg.routing === "wilayah" ? req.wilayah : req.kategori;
  if (!nilai) return { kurang: cfg.routing };
  const hk = cfg.hodKeyMap?.[nilai];
  return { hodKey: typeof hk === "string" && hk.trim() ? hk : null };
}

// Pure — isi snapshot satu langkah (approval_step.hod_key/group_key) dari
// config tahap + atribut request. Tahap 'hod' ber-routing yang atributnya
// kosong dibiarkan null; resolveStepTargets mengisinya belakangan.
export function snapshotTahap(
  cfg: Pick<ChainConfigRow, "targetType" | "routing" | "hodKey" | "hodKeyMap" | "groupKey">,
  req: { wilayah: string | null; kategori: string | null; hodPengaju: string | null },
): { hodKey: string | null; groupKey: string | null } {
  switch (cfg.targetType) {
    case "direktur":
      return { hodKey: null, groupKey: null };
    case "hod_pengaju":
      return { hodKey: req.hodPengaju, groupKey: null };
    case "grup":
      return { hodKey: null, groupKey: cfg.groupKey };
    case "hod": {
      const pilih = pilihHodKey(cfg, req);
      return { hodKey: "hodKey" in pilih ? pilih.hodKey : null, groupKey: null };
    }
  }
}

function toRouting(v: unknown): Routing {
  return v === "wilayah" || v === "kategori" ? v : "tetap";
}

function toHodKeyMap(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.trim()) out[k] = val;
  }
  return out;
}

function toChainRow(r: Record<string, unknown>): ChainConfigRow {
  return {
    jenis: String(r.jenis),
    urutan: Number(r.urutan),
    label: String(r.label),
    targetType: toTargetType(r.target_type),
    hodKey: r.hod_key ? String(r.hod_key) : null,
    groupKey: r.group_key ? String(r.group_key) : null,
    aktif: r.aktif !== false,
    waNumberOverride: r.wa_number_override ? String(r.wa_number_override) : null,
    catatan: r.catatan ? String(r.catatan) : null,
    routing: toRouting(r.routing),
    hodKeyMap: toHodKeyMap(r.hod_key_map),
  };
}

// ── Alur ───────────────────────────────────────────────────────────

export interface AlurRow {
  jenis: string;
  label: string;
  slaJam: number | null;
  eskalasi: boolean;
  catatan: string | null;
}

export async function listAlur(): Promise<AlurRow[]> {
  const sql = db();
  const rows = await sql`SELECT jenis, label, sla_jam, eskalasi, catatan FROM approval_alur ORDER BY jenis = ${JENIS_BAWAAN} DESC, label`;
  return rows.map((r) => ({
    jenis: String(r.jenis),
    label: String(r.label),
    slaJam: r.sla_jam != null ? Number(r.sla_jam) : null,
    eskalasi: r.eskalasi === true,
    catatan: r.catatan ? String(r.catatan) : null,
  }));
}

// Pilihan grup untuk tahap target 'grup' di halaman config. Disajikan di
// sini (bukan lewat /admin/access/groups) karena config approval juga dibuka
// untuk Direktur, sedangkan endpoint admin hanya untuk admin.
export async function listGrupAkses(): Promise<{ key: string; name: string }[]> {
  const sql = db();
  const rows = await sql`SELECT key, name FROM access_group ORDER BY name`;
  return rows.map((r) => ({ key: String(r.key), name: String(r.name) }));
}

export async function updateAlur(
  jenis: string,
  patch: { slaJam?: unknown; eskalasi?: unknown },
): Promise<{ ok: boolean; error?: string }> {
  if (patch.slaJam !== undefined && patch.slaJam !== null) {
    const n = Number(patch.slaJam);
    if (!Number.isInteger(n) || n < 1 || n > 720) return { ok: false, error: "SLA harus jam bulat 1–720, atau kosong (tanpa SLA)" };
  }
  if (patch.eskalasi !== undefined && typeof patch.eskalasi !== "boolean") return { ok: false, error: "eskalasi harus true/false" };
  const sql = db();
  const rows = await sql`
    UPDATE approval_alur SET
      sla_jam = ${patch.slaJam === undefined ? sql`sla_jam` : patch.slaJam === null ? null : Number(patch.slaJam)},
      eskalasi = ${patch.eskalasi === undefined ? sql`eskalasi` : (patch.eskalasi as boolean)},
      updated_at = now()
    WHERE jenis = ${jenis}
    RETURNING jenis
  `;
  if (rows.length === 0) return { ok: false, error: `alur "${jenis}" tidak ditemukan` };
  return { ok: true };
}

// ── Config tahap ───────────────────────────────────────────────────

export async function listChainConfig(jenis: string = JENIS_BAWAAN): Promise<ChainConfigRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT jenis, urutan, label, target_type, hod_key, group_key, aktif, wa_number_override, catatan, routing, hod_key_map
    FROM approval_chain_config WHERE jenis = ${jenis} ORDER BY urutan
  `;
  return rows.map(toChainRow);
}

export interface ChainConfigPatch {
  hodKey?: string | null;
  waNumberOverride?: string | null;
  // Hanya untuk tahap ber-routing. Nilai null/"" = hapus entri (belum dikonfigurasi).
  hodKeyMap?: Record<string, string | null>;
  // Hanya untuk tahap target 'grup'.
  groupKey?: string | null;
  aktif?: boolean;
}

// Pure — validasi + gabung patch peta ke peta lama. Kunci di luar kosakata
// routing ditolak supaya salah ketik ("East", "ivd") tak jadi entri mati.
export function gabungPetaHod(
  routing: Routing,
  lama: Record<string, string> | null,
  patch: Record<string, string | null>,
): { ok: true; peta: Record<string, string> } | { ok: false; error: string } {
  if (routing === "tetap") return { ok: false, error: "tahap ini tidak diarahkan per atribut — ubah hod_key, bukan peta" };
  const sah = nilaiRouting(routing);
  const peta: Record<string, string> = { ...(lama ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!sah.includes(k)) return { ok: false, error: `kunci peta "${k}" tidak sah untuk routing ${routing} (sah: ${sah.join(", ")})` };
    if (v === null || v === undefined || (typeof v === "string" && !v.trim())) delete peta[k];
    else if (typeof v === "string") peta[k] = v.trim();
    else return { ok: false, error: `nilai peta "${k}" harus hod_key (teks) atau null` };
  }
  return { ok: true, peta };
}

// Pure — field patch mana yang bermakna untuk jenis tahap ini. Menyimpan
// field yang diabaikan resolveStepTargets cuma menciptakan pengaturan yang
// tampak berlaku padahal tidak.
export function cekPatchTahap(
  cfg: Pick<ChainConfigRow, "targetType" | "routing">,
  patch: ChainConfigPatch,
): string | null {
  const isHodTetap = cfg.targetType === "hod" && cfg.routing === "tetap";
  if (patch.hodKey !== undefined && !isHodTetap) {
    return cfg.targetType === "hod"
      ? `tahap ini diarahkan per ${cfg.routing} — atur lewat peta, bukan hod_key`
      : `tahap ber-target "${cfg.targetType}" tidak memakai hod_key`;
  }
  if (patch.waNumberOverride !== undefined && !(isHodTetap || cfg.targetType === "direktur")) {
    return `override nomor hanya berlaku untuk tahap HoD tetap atau Direktur`;
  }
  if (patch.hodKeyMap !== undefined && !(cfg.targetType === "hod" && cfg.routing !== "tetap")) {
    return "tahap ini tidak diarahkan per atribut — peta tidak dipakai";
  }
  if (patch.groupKey !== undefined && cfg.targetType !== "grup") {
    return `tahap ber-target "${cfg.targetType}" tidak memakai grup`;
  }
  if (patch.aktif !== undefined && typeof patch.aktif !== "boolean") return "aktif harus true/false";
  return null;
}

export async function updateChainConfig(
  jenis: string,
  urutan: number,
  patch: ChainConfigPatch,
): Promise<{ ok: boolean; error?: string }> {
  const sql = db();
  const rows = await sql`SELECT target_type, routing, hod_key_map FROM approval_chain_config WHERE jenis = ${jenis} AND urutan = ${urutan}`;
  if (rows.length === 0) return { ok: false, error: `tahap ${jenis}/${urutan} tidak ditemukan` };
  const cfg = { targetType: toTargetType(rows[0].target_type), routing: toRouting(rows[0].routing) };
  const salah = cekPatchTahap(cfg, patch);
  if (salah) return { ok: false, error: salah };

  let peta: Record<string, string> | undefined;
  if (patch.hodKeyMap !== undefined) {
    if (!patch.hodKeyMap || typeof patch.hodKeyMap !== "object" || Array.isArray(patch.hodKeyMap)) {
      return { ok: false, error: "hodKeyMap harus objek" };
    }
    const g = gabungPetaHod(cfg.routing, toHodKeyMap(rows[0].hod_key_map), patch.hodKeyMap);
    if (!g.ok) return { ok: false, error: g.error };
    peta = g.peta;
  }
  let waNumberOverride = patch.waNumberOverride;
  if (waNumberOverride) {
    const normalized = normalizeWa(waNumberOverride);
    if (normalized.length < 9) return { ok: false, error: "wa_number_override bukan nomor WA yang valid" };
    waNumberOverride = normalized;
  }
  let groupKey = patch.groupKey;
  if (groupKey) {
    const [g] = await sql`SELECT key FROM access_group WHERE key = ${groupKey}`;
    if (!g) return { ok: false, error: `grup akses "${groupKey}" tidak ada` };
    groupKey = String(g.key);
  }
  await sql`
    UPDATE approval_chain_config SET
      hod_key = ${patch.hodKey === undefined ? sql`hod_key` : patch.hodKey},
      wa_number_override = ${waNumberOverride === undefined ? sql`wa_number_override` : waNumberOverride},
      hod_key_map = ${peta === undefined ? sql`hod_key_map` : sql.json(peta)},
      group_key = ${groupKey === undefined ? sql`group_key` : groupKey || null},
      aktif = ${patch.aktif === undefined ? sql`aktif` : patch.aktif},
      updated_at = now()
    WHERE jenis = ${jenis} AND urutan = ${urutan}
  `;
  return { ok: true };
}

// ── Resolusi target ────────────────────────────────────────────────

interface ResolvedTarget {
  waNumber: string;
  name: string;
}

// Kenapa sebuah tahap tak bisa dikirimi notifikasi. Dipisah per sebab karena
// TEMPAT MEMPERBAIKINYA BERBEDA — dan sebelumnya ketiganya dilaporkan dengan
// satu kalimat "belum dikonfigurasi — isi di halaman config", yang benar cuma
// untuk sebab pertama. Untuk dua sisanya kalimat itu menyesatkan: orang membuka
// halaman config, melihat slotnya SUDAH terisi, lalu buntu (#1071).
export type SebabTargetGagal =
  | { sebab: "belum-dikonfigurasi"; label: string }
  | { sebab: "hod-tanpa-pengguna"; label: string; hodKey: string }
  | { sebab: "hod-tanpa-wa"; label: string; hodKey: string; nama: string }
  | { sebab: "direktur-tak-ada"; label: string }
  | { sebab: "atribut-kosong"; label: string; atribut: "wilayah" | "kategori" }
  | { sebab: "grup-tanpa-wa"; label: string; groupKey: string };

// Pure — dites terpisah tanpa DB.
export function pesanTargetGagal(g: SebabTargetGagal): string {
  switch (g.sebab) {
    case "belum-dikonfigurasi":
      return `Kontak tahap "${g.label}" belum diisi — isi di halaman Config Chain (Approval → Config).`;
    case "hod-tanpa-pengguna":
      return `Tahap "${g.label}" menunjuk hod_key "${g.hodKey}", tapi tak ada pengguna dengan hod_key itu — perbaiki di menu Pengguna, bukan di Config Chain.`;
    case "hod-tanpa-wa":
      return `Tahap "${g.label}" menunjuk ${g.nama} (hod_key "${g.hodKey}"), tapi nomor WA-nya kosong — isi nomor WA pengguna itu di menu Pengguna.`;
    case "direktur-tak-ada":
      return `Tahap "${g.label}" menunggu Direktur, tapi tak ada pengguna ber-role "direktur" yang punya nomor WA — set di menu Pengguna.`;
    case "atribut-kosong":
      return g.atribut === "wilayah"
        ? `Tahap "${g.label}" diarahkan per wilayah pengaju (lihat peta di Config Chain), tapi permintaan ini tak mencantumkan wilayah — isi wilayahnya di halaman detail permintaan.`
        : `Tahap "${g.label}" diarahkan per kategori barang (lihat peta di Config Chain), tapi permintaan ini tak mencantumkan kategori — isi kategorinya di halaman detail permintaan.`;
    case "grup-tanpa-wa":
      return `Tahap "${g.label}" menunggu anggota grup akses "${g.groupKey}", tapi tak ada anggota aktif bernomor WA (selain pengaju) — atur anggota grup di menu Akses Grup atau isi nomor WA di menu Pengguna.`;
  }
}

interface StepUntukTarget {
  id: number;
  urutan: number;
  target_type: TargetType;
  hod_key: string | null;
  group_key: string | null;
  label: string;
}

interface ReqUntukTarget {
  jenis: string;
  wilayah: string | null;
  kategori: string | null;
  requestedByUserId: string | null;
}

// Resolusi target notifikasi 1 tahap. Gagal = state SAH (kontak belum diisi,
// atau app_user-nya belum punya wa_number), bukan exception — jadi
// dikembalikan sebagai nilai, bukan throw. Tahap 'grup' bisa ber-target
// banyak orang (semua anggota grup selain pengaju).
async function resolveStepTargets(step: StepUntukTarget, req: ReqUntukTarget): Promise<ResolvedTarget[] | { gagal: SebabTargetGagal }> {
  const sql = db();
  // Config LIVE selalu dicek (bukan cuma saat snapshot kosong) — wa_number_override
  // butuh ini juga, dan hod_key di-snapshot NULL berarti "belum dikonfigurasi
  // SAAT request dibuat", BUKAN keputusan permanen yg wajib dijaga historis
  // (beda dari hod_key yg SUDAH terisi, itu tetap dipertahankan apa adanya
  // walau config global berubah nanti). Backfill snapshot kalau config live
  // sudah diisi belakangan — inilah yg bikin endpoint retry-notify
  // (POST /approval-requests/:id/notify) beneran berguna, bukan percuma.
  const [cfgRow] = await sql`
    SELECT jenis, urutan, label, target_type, hod_key, group_key, aktif, wa_number_override, catatan, routing, hod_key_map
    FROM approval_chain_config WHERE jenis = ${req.jenis} AND urutan = ${step.urutan}
  `;
  const cfg = cfgRow ? toChainRow(cfgRow) : null;
  // Override satu nomor untuk seluruh slot bertentangan dengan routing (tahap
  // ini sengaja ke orang berbeda per request) — jadi hanya berlaku di 'tetap'.
  const override =
    cfg && cfg.waNumberOverride && (step.target_type === "direktur" || (step.target_type === "hod" && cfg.routing === "tetap"))
      ? cfg.waNumberOverride
      : null;
  if (override) return [{ waNumber: override, name: `(override tahap ${step.urutan})` }];

  if (step.target_type === "direktur") {
    const rows = await sql`SELECT name, wa_number FROM app_user WHERE role = 'direktur' AND active = true AND wa_number IS NOT NULL AND wa_number <> '' ORDER BY created_at LIMIT 1`;
    if (rows.length === 0) return { gagal: { sebab: "direktur-tak-ada", label: step.label } };
    return [{ waNumber: String(rows[0].wa_number), name: rows[0].name ? String(rows[0].name) : "Direktur" }];
  }

  if (step.target_type === "grup") {
    let groupKey = step.group_key;
    if (!groupKey && cfg?.groupKey) {
      groupKey = cfg.groupKey;
      await sql`UPDATE approval_step SET group_key = ${groupKey} WHERE id = ${step.id}`;
    }
    if (!groupKey) return { gagal: { sebab: "belum-dikonfigurasi", label: step.label } };
    const rows = await sql`
      SELECT DISTINCT u.name, u.wa_number
      FROM app_user u
      JOIN app_user_group ug ON ug.user_id = u.id
      JOIN access_group g ON g.id = ug.group_id
      WHERE g.key = ${groupKey} AND u.active = true
        AND u.wa_number IS NOT NULL AND u.wa_number <> ''
        AND u.id IS DISTINCT FROM ${req.requestedByUserId}
    `;
    if (rows.length === 0) return { gagal: { sebab: "grup-tanpa-wa", label: step.label, groupKey } };
    return rows.map((r) => ({ waNumber: String(r.wa_number), name: r.name ? String(r.name) : groupKey! }));
  }

  // 'hod' & 'hod_pengaju'
  let hodKey = step.hod_key;
  if (!hodKey && cfg && step.target_type === "hod") {
    const pilih = pilihHodKey(cfg, req);
    if ("kurang" in pilih) return { gagal: { sebab: "atribut-kosong", label: step.label, atribut: pilih.kurang } };
    if (pilih.hodKey) {
      hodKey = pilih.hodKey;
      await sql`UPDATE approval_step SET hod_key = ${hodKey} WHERE id = ${step.id}`;
    }
  }
  if (!hodKey) return { gagal: { sebab: "belum-dikonfigurasi", label: step.label } };
  const rows = await sql`SELECT name, wa_number FROM app_user WHERE hod_key = ${hodKey} AND active = true AND wa_number IS NOT NULL AND wa_number <> '' ORDER BY created_at LIMIT 1`;
  if (rows.length === 0) {
    // Bedakan "tak ada penggunanya" dari "penggunanya ada tapi nomor WA kosong".
    // Dua-duanya diperbaiki di menu Pengguna, tapi langkahnya beda: yang satu
    // menautkan hod_key ke orang, yang satu mengisi nomor.
    const [tanpaWa] = await sql`SELECT name FROM app_user WHERE hod_key = ${hodKey} ORDER BY created_at LIMIT 1`;
    if (tanpaWa) {
      return { gagal: { sebab: "hod-tanpa-wa", label: step.label, hodKey, nama: tanpaWa.name ? String(tanpaWa.name) : hodKey } };
    }
    return { gagal: { sebab: "hod-tanpa-pengguna", label: step.label, hodKey } };
  }
  return [{ waNumber: String(rows[0].wa_number), name: rows[0].name ? String(rows[0].name) : hodKey }];
}

function generateKode(seq: number): string {
  return `APR-${String(seq).padStart(4, "0")}`;
}

async function logAudit(eventType: string, actor: string | null | undefined, payload: Record<string, unknown>, decision: string): Promise<void> {
  const sql = db();
  const hash = createHash("sha256").update(JSON.stringify({ eventType, payload })).digest("hex");
  // agent_id FK ke agent_registry (cuma A1-A12) — F11 bukan agen LLM, tapi
  // audit trail approval tetap berharga dicatat. Dipilih 'A3' (Sari
  // Collection, R2/human-decision paling mirip) drpd nambah agent_registry
  // baru cuma buat satu FK ini; kalau nanti butuh identitas sendiri, bikin
  // baris agent_registry 'F11' + migrasi kecil.
  await sql`
    INSERT INTO audit_log (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload, human_actor, decision)
    VALUES ('D1', ${`apr-${hash.slice(0, 8)}`}, 'A3', 5, ${eventType}, 'R2', ${hash}, ${hash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])}, ${actor ?? null}, ${decision})
  `;
}

function appUrl(): string {
  // WEB_PUBLIC_URL didahulukan: NEXT_PUBLIC_APP_URL tak pernah diisi di
  // .env.prod, jadi fallback lama mengirim link "localhost:3000" ke WA orang.
  return (process.env.WEB_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  waNumber?: string;
  terkirim?: number;
}

interface CurrentStepCtx {
  req: Record<string, unknown>;
  step: StepUntukTarget & { status: string };
  targets: ResolvedTarget[];
}

async function muatTahapCurrent(requestId: string): Promise<CurrentStepCtx | { error: string }> {
  const sql = db();
  const [req] = await sql`
    SELECT id, kode, jenis, title, description, nominal, status, current_urutan, requested_by, requested_by_user_id, wilayah, kategori
    FROM approval_request WHERE id = ${requestId}
  `;
  if (!req) return { error: "request tidak ditemukan" };
  if (req.status !== "pending") return { error: `request sudah ${req.status}` };
  const [s] = await sql`SELECT id, urutan, label, target_type, hod_key, group_key, status FROM approval_step WHERE request_id = ${requestId} AND urutan = ${req.current_urutan}`;
  if (!s) return { error: "tahap current tidak ditemukan" };
  if (s.status !== "pending") return { error: `tahap ini sudah ${s.status}` };
  const step = {
    id: Number(s.id),
    urutan: Number(s.urutan),
    target_type: toTargetType(s.target_type),
    hod_key: s.hod_key ? String(s.hod_key) : null,
    group_key: s.group_key ? String(s.group_key) : null,
    label: String(s.label),
    status: String(s.status),
  };
  const targets = await resolveStepTargets(step, {
    jenis: String(req.jenis),
    wilayah: req.wilayah ? String(req.wilayah) : null,
    kategori: req.kategori ? String(req.kategori) : null,
    requestedByUserId: req.requested_by_user_id ? String(req.requested_by_user_id) : null,
  });
  if ("gagal" in targets) return { error: pesanTargetGagal(targets.gagal) };
  return { req, step, targets };
}

async function kirimKeTarget(targets: ResolvedTarget[], msg: string): Promise<{ terkirim: ResolvedTarget[]; gagal: string[] }> {
  const terkirim: ResolvedTarget[] = [];
  const gagal: string[] = [];
  for (const t of targets) {
    const gw = await sendViaWaGateway(t.waNumber, msg);
    if (gw.sent) terkirim.push(t);
    else gagal.push(`${t.name} (${t.waNumber}): ${gw.error ?? `HTTP ${gw.status ?? "?"}`}`);
  }
  return { terkirim, gagal };
}

// Kirim/kirim-ulang notifikasi tahap CURRENT punya 1 request. Dipanggil saat
// request dibuat & saat tahap sebelumnya approve (advance ke tahap
// berikutnya) — DAN bisa dipanggil manual (retry) via API kalau kontak baru
// diisi setelah sempat gagal.
export async function notifyCurrentStep(requestId: string): Promise<NotifyResult> {
  const sql = db();
  const ctx = await muatTahapCurrent(requestId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { req, step, targets } = ctx;

  const nominalLine = req.nominal != null ? `\nNominal: Rp${Number(req.nominal).toLocaleString("id-ID")}` : "";
  // Lampiran dikirim sbg LINK web (bukan file media WA) — gateway openclaw
  // yg dipakai sekarang cuma terima {to, message} teks (lihat wasend.ts),
  // tak ada kontrak kirim media. Link tetap ke halaman dashboard (bukan API
  // langsung) supaya lewat gerbang sesi (middleware.ts) yg sudah ada.
  const [{ count: attachCount }] = await sql`SELECT count(*)::int AS count FROM approval_attachment WHERE request_id = ${requestId}`;
  const url = appUrl();
  // Kalau URL kosong, sebut jumlah lampirannya saja — link setengah jadi
  // ("/approval-requests/12") lebih menyesatkan ketimbang tanpa link.
  const attachLine = Number(attachCount) > 0
    ? `\n📎 ${attachCount} lampiran${url ? ` — lihat di ${url}/approval-requests/${requestId}` : ""}\n`
    : "";
  const dashLine = url ? `\nAtau putuskan di dashboard: ${url}/approval-requests/${requestId}` : "";
  const msg =
    `🔔 *Permintaan Approval* (${step.label})\n\n` +
    `${req.title}${nominalLine}\n${req.description ? `${req.description}\n` : ""}${attachLine}` +
    `Diajukan oleh: ${req.requested_by ?? "-"}\n\n` +
    `Kode: *${req.kode}*\n` +
    `Balas *#APPROVE ${req.kode}* untuk setujui, atau *#REJECT ${req.kode} ALASAN* untuk tolak.${dashLine}`;

  const kirim = await kirimKeTarget(targets, msg);
  await logAudit(
    "approval.notify",
    null,
    { request_id: requestId, kode: req.kode, urutan: step.urutan, target: targets.map((t) => t.waNumber), gagal: kirim.gagal },
    "notify",
  );
  // Gateway menolak/gagal (allowlist, HTTP error, jaringan) = BELUM terkirim.
  // Dulu tetap dibalas ok:true + notified_at terisi, jadi layar bilang
  // "terkirim" padahal approver tak pernah menerima apa pun.
  if (kirim.terkirim.length === 0) {
    return { ok: false, error: `WA gagal terkirim — ${kirim.gagal.join("; ")} — coba kirim ulang dari halaman detail permintaan.` };
  }
  // notified_at = awal hitungan SLA tahap ini; jejak pengingat direset supaya
  // kirim ulang manual tak langsung dianggap terlambat.
  await sql`UPDATE approval_step SET notified_at = now(), reminded_at = NULL, escalated_at = NULL WHERE id = ${step.id}`;
  return { ok: true, waNumber: kirim.terkirim[0].waNumber, terkirim: kirim.terkirim.length };
}

// ── Buat request ───────────────────────────────────────────────────

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface CreateApprovalInput {
  // Alur yang dipakai; default 'pengadaan' (chain asli F11).
  jenis?: string;
  title: string;
  description?: string | null;
  nominal?: number | null;
  requestedBy: string;
  requestedByWa?: string | null;
  // Akun pengaju (dari sesi web). Kalau ada, nomor WA untuk kabar hasil akhir
  // diambil dari akunnya — bukan diketik bebas di form — dan akun ini tak
  // boleh memutuskan request-nya sendiri.
  requestedByUserId?: string | null;
  attachments?: AttachmentInput[];
  // Dipakai tahap ber-routing (migrasi 190). Opsional di level engine supaya
  // pemanggil lama (F19 forecast) tetap bisa membuat request; tahap yang
  // butuh atribut kosong tertahan dengan sebab 'atribut-kosong'.
  wilayah?: Wilayah | null;
  kategori?: Kategori | null;
  // Wajib bila alurnya punya tahap 'hod_pengaju' (mis. HoD divisi pengaju),
  // kecuali jikaHodKosong = 'direktur'.
  hodPengaju?: string | null;
  // Tahap 'hod_pengaju' saat HoD pengaju tak diketahui: 'tolak' (default)
  // menolak membuat request; 'direktur' mengalihkan tahap itu ke Direktur
  // (dicatat di langkahnya, bukan di config).
  jikaHodKosong?: "tolak" | "direktur";
  // Tautan ke baris modul induk (konsumen). Berpasangan.
  refTabel?: string | null;
  refId?: string | null;
}

export interface CreateApprovalResult {
  ok: boolean;
  error?: string;
  id?: string;
  kode?: string;
  notify?: NotifyResult;
}

// Validasi SEMUA lampiran DULU (mime, ukuran, base64 valid) sebelum baris
// apa pun disimpan ke DB — cegah state setengah-jadi (request kebentuk tapi
// lampirannya cuma sebagian krn salah 1 file di tengah gagal).
function validateAttachments(attachments: AttachmentInput[]): { ok: true; buffers: Buffer[] } | { ok: false; error: string } {
  const buffers: Buffer[] = [];
  for (const a of attachments) {
    if (!ALLOWED_MIME.has(a.mimeType)) {
      return { ok: false, error: `"${a.filename}": tipe file "${a.mimeType}" tidak didukung — cuma PDF atau PNG` };
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(a.dataBase64, "base64");
    } catch {
      return { ok: false, error: `"${a.filename}": data base64 tidak valid` };
    }
    if (buf.length === 0) return { ok: false, error: `"${a.filename}": file kosong` };
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `"${a.filename}": ukuran ${(buf.length / 1024 / 1024).toFixed(1)}MB melebihi batas 8MB` };
    }
    buffers.push(buf);
  }
  return { ok: true, buffers };
}

async function saveAttachment(requestId: string, input: AttachmentInput, buf: Buffer): Promise<void> {
  const sql = db();
  const ext = input.mimeType === "application/pdf" ? "pdf" : "png";
  const relPath = join(requestId, `${randomUUID()}.${ext}`);
  const absPath = join(APPROVAL_UPLOAD_ROOT, relPath);
  await mkdir(join(APPROVAL_UPLOAD_ROOT, requestId), { recursive: true });
  await writeFile(absPath, buf);
  await sql`
    INSERT INTO approval_attachment (request_id, filename, mime_type, file_path, file_size)
    VALUES (${requestId}, ${input.filename}, ${input.mimeType}, ${relPath}, ${buf.length})
  `;
}

// Pure — validasi input yang tak butuh DB.
export function validasiInputRequest(input: CreateApprovalInput): string | null {
  if (!input.title?.trim()) return "title wajib";
  if (!input.requestedBy?.trim()) return "requestedBy wajib";
  if (input.nominal != null && !Number.isFinite(input.nominal)) return "nominal harus berupa angka";
  if (input.nominal != null && input.nominal < 0) return "nominal tidak boleh negatif";
  if (input.wilayah != null && !isWilayah(input.wilayah)) return `wilayah harus salah satu dari: ${WILAYAH.join(", ")}`;
  if (input.kategori != null && !isKategori(input.kategori)) return `kategori harus salah satu dari: ${KATEGORI.join(", ")}`;
  if (!!input.refTabel !== !!input.refId) return "refTabel & refId harus diisi berpasangan";
  return null;
}

// Pure — alur yang punya tahap hod_pengaju wajib dibuat dengan hodPengaju;
// tanpa itu tahapnya tak punya orang dan request menggantung tanpa sebab yang
// bisa diperbaiki dari halaman mana pun.
export function cekChainUntukRequest(
  chain: Pick<ChainConfigRow, "targetType" | "label">[],
  hodPengaju: string | null,
  jikaHodKosong: "tolak" | "direktur" = "tolak",
): string | null {
  if (chain.length === 0) return "alur ini belum punya tahap aktif";
  const butuh = chain.find((c) => c.targetType === "hod_pengaju");
  if (butuh && !hodPengaju && jikaHodKosong === "tolak") return `tahap "${butuh.label}" butuh HoD pengaju, tapi permintaan tak membawanya`;
  return null;
}

// Inti pembuatan request DI DALAM transaksi pemanggil — dipakai modul
// konsumen supaya baris induk + request lahir atomik. Notifikasi TIDAK
// dikirim di sini (WA tak boleh terkirim untuk transaksi yang batal);
// pemanggil wajib memanggil notifyCurrentStep(id) sesudah commit.
export async function buatRequestDalamTx(
  tx: Tx,
  input: CreateApprovalInput,
): Promise<{ ok: true; id: string; kode: string } | { ok: false; error: string }> {
  const salah = validasiInputRequest(input);
  if (salah) return { ok: false, error: salah };
  const jenis = input.jenis?.trim() || JENIS_BAWAAN;
  const wilayah = input.wilayah ?? null;
  const kategori = input.kategori ?? null;
  const hodPengaju = input.hodPengaju?.trim() || null;

  const [alur] = await tx`SELECT jenis FROM approval_alur WHERE jenis = ${jenis}`;
  if (!alur) return { ok: false, error: `alur approval "${jenis}" tidak dikenal` };
  const chain = (
    await tx`
      SELECT jenis, urutan, label, target_type, hod_key, group_key, aktif, wa_number_override, catatan, routing, hod_key_map
      FROM approval_chain_config WHERE jenis = ${jenis} AND aktif ORDER BY urutan
    `
  ).map(toChainRow);
  const jikaHodKosong = input.jikaHodKosong ?? "tolak";
  const salahChain = cekChainUntukRequest(chain, hodPengaju, jikaHodKosong);
  if (salahChain) return { ok: false, error: salahChain };

  let requestedByWa = input.requestedByWa ?? null;
  if (input.requestedByUserId) {
    const [u] = await tx`SELECT wa_number FROM app_user WHERE id = ${input.requestedByUserId}`;
    requestedByWa = u?.wa_number ? String(u.wa_number) : null;
  }

  if (input.refTabel) {
    const [dobel] = await tx`
      SELECT kode FROM approval_request WHERE ref_tabel = ${input.refTabel} AND ref_id = ${input.refId!} AND status = 'pending'
    `;
    if (dobel) return { ok: false, error: `sudah ada approval berjalan untuk data ini (${dobel.kode})` };
  }

  const [{ nextval }] = await tx`SELECT nextval('approval_request_kode_seq') AS nextval`;
  const kode = generateKode(Number(nextval));
  const [reqRow] = await tx`
    INSERT INTO approval_request
      (kode, jenis, title, description, nominal, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, wilayah, kategori, hod_pengaju, ref_tabel, ref_id)
    VALUES
      (${kode}, ${jenis}, ${input.title}, ${input.description ?? null}, ${input.nominal ?? null}, ${input.requestedBy},
       ${requestedByWa}, ${input.requestedByUserId ?? null}, ${chain[0].urutan}, ${wilayah}, ${kategori}, ${hodPengaju},
       ${input.refTabel ?? null}, ${input.refId ?? null})
    RETURNING id
  `;
  const requestId = String(reqRow.id);
  for (const c of chain) {
    // Snapshot per tahap: hod_key (tetap/peta/pengaju) atau group_key. Null
    // = belum bisa ditentukan sekarang; diisi resolveStepTargets saat retry.
    const keDirektur = c.targetType === "hod_pengaju" && !hodPengaju && jikaHodKosong === "direktur";
    const snap = snapshotTahap(c, { wilayah, kategori, hodPengaju });
    await tx`
      INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key, group_key)
      VALUES (${requestId}, ${c.urutan}, ${keDirektur ? `${c.label} (dialihkan ke Direktur)` : c.label},
              ${keDirektur ? "direktur" : c.targetType}, ${keDirektur ? null : snap.hodKey}, ${keDirektur ? null : snap.groupKey})
    `;
  }
  return { ok: true, id: requestId, kode };
}

export async function createApprovalRequest(input: CreateApprovalInput): Promise<CreateApprovalResult> {
  if (!isDbEnabled()) return { ok: false, error: "DATABASE_URL off" };
  const salah = validasiInputRequest(input);
  if (salah) return { ok: false, error: salah };
  const attachments = input.attachments ?? [];
  const validated = validateAttachments(attachments);
  if (!validated.ok) return { ok: false, error: validated.error };

  const sql = db();
  const made = await sql.begin((tx) => buatRequestDalamTx(tx as unknown as Tx, input));
  if (!made.ok) return { ok: false, error: made.error };

  for (let i = 0; i < attachments.length; i++) {
    await saveAttachment(made.id, attachments[i], validated.buffers[i]);
  }
  await logAudit(
    "approval.request.create",
    input.requestedBy,
    { request_id: made.id, kode: made.kode, jenis: input.jenis ?? JENIS_BAWAAN, title: input.title, attachments: attachments.length, ref_tabel: input.refTabel ?? null, ref_id: input.refId ?? null },
    "create",
  );
  const notify = await notifyCurrentStep(made.id);
  return { ok: true, id: made.id, kode: made.kode, notify };
}

// Lengkapi atribut routing request yang TERLANJUR dibuat tanpa atribut
// (request lama, atau pemanggil yang belum mengisinya). Sengaja hanya
// MENGISI yang kosong, tidak MENGGANTI: begitu atribut terisi, hod_key tahap
// sudah bisa tersnapshot dan approver-nya mungkin sudah dinotifikasi —
// mengganti diam-diam memindahkan approval ke orang lain di tengah jalan.
export async function lengkapiAtributRequest(
  id: string,
  input: { wilayah?: unknown; kategori?: unknown },
): Promise<{ ok: boolean; error?: string; notify?: NotifyResult }> {
  if (input.wilayah === undefined && input.kategori === undefined) return { ok: false, error: "isi wilayah atau kategori" };
  if (input.wilayah !== undefined && !isWilayah(input.wilayah)) {
    return { ok: false, error: `wilayah harus salah satu dari: ${WILAYAH.join(", ")}` };
  }
  if (input.kategori !== undefined && !isKategori(input.kategori)) {
    return { ok: false, error: `kategori harus salah satu dari: ${KATEGORI.join(", ")}` };
  }
  const sql = db();
  const [req] = await sql`SELECT status, wilayah, kategori FROM approval_request WHERE id = ${id}`;
  if (!req) return { ok: false, error: "request tidak ditemukan" };
  if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };
  if (input.wilayah !== undefined && req.wilayah) return { ok: false, error: `wilayah sudah terisi (${req.wilayah}) — tidak bisa diganti` };
  if (input.kategori !== undefined && req.kategori) return { ok: false, error: `kategori sudah terisi (${req.kategori}) — tidak bisa diganti` };
  await sql`
    UPDATE approval_request SET
      wilayah = ${input.wilayah === undefined ? sql`wilayah` : (input.wilayah as string)},
      kategori = ${input.kategori === undefined ? sql`kategori` : (input.kategori as string)}
    WHERE id = ${id} AND status = 'pending'
  `;
  await logAudit("approval.request.atribut", null, { request_id: id, wilayah: input.wilayah ?? null, kategori: input.kategori ?? null }, "update");
  // Tahap current mungkin tadinya tertahan karena atribut ini — coba kirim.
  const notify = await notifyCurrentStep(id);
  return { ok: true, notify };
}

// ── Baca ───────────────────────────────────────────────────────────

export interface ApprovalStepRow {
  urutan: number;
  label: string;
  targetType: TargetType;
  hodKey: string | null;
  groupKey: string | null;
  status: string;
  notifiedAt: string | null;
  remindedAt: string | null;
  escalatedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedVia: string | null;
  decisionNote: string | null;
}

export interface ApprovalAttachmentRow {
  id: number;
  filename: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
}

export interface ApprovalRequestDetail {
  id: string;
  kode: string;
  jenis: string;
  jenisLabel: string;
  title: string;
  description: string | null;
  nominal: number | null;
  requestedBy: string;
  wilayah: Wilayah | null;
  kategori: Kategori | null;
  hodPengaju: string | null;
  refTabel: string | null;
  refId: string | null;
  status: string;
  currentUrutan: number | null;
  createdAt: string;
  decidedAt: string | null;
  slaJam: number | null;
  // Batas SLA tahap current (notified_at + sla_jam). Null = tanpa SLA / belum dinotif.
  slaDueAt: string | null;
  // Dihitung di server — komponen React tak boleh membaca jam saat render.
  slaLewat: boolean;
  steps: ApprovalStepRow[];
  attachments: ApprovalAttachmentRow[];
  // Diisi bila dibaca untuk pengguna tertentu (opsi viewerUserId).
  wewenang?: { boleh: boolean; alasan: string | null };
}

export async function getApprovalRequest(id: string, opts: { viewerUserId?: string | null } = {}): Promise<ApprovalRequestDetail | null> {
  const sql = db();
  const rows = await sql`
    SELECT r.id, r.kode, r.jenis, a.label AS jenis_label, a.sla_jam, r.title, r.description, r.nominal, r.requested_by,
           r.requested_by_user_id, r.wilayah, r.kategori, r.hod_pengaju, r.ref_tabel, r.ref_id, r.status, r.current_urutan,
           r.created_at::text, r.decided_at::text
    FROM approval_request r JOIN approval_alur a ON a.jenis = r.jenis
    WHERE r.id = ${id}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const stepRows = await sql`
    SELECT urutan, label, target_type, hod_key, group_key, status, notified_at, notified_at::text AS notified_txt,
           reminded_at::text, escalated_at::text, decided_by, decided_at::text, decided_via, decision_note
    FROM approval_step WHERE request_id = ${id} ORDER BY urutan
  `;
  const attachmentRows = await sql`
    SELECT id, filename, mime_type, file_size, uploaded_at::text
    FROM approval_attachment WHERE request_id = ${id} ORDER BY id
  `;
  const slaJam = r.sla_jam != null ? Number(r.sla_jam) : null;
  const cur = stepRows.find((s) => Number(s.urutan) === Number(r.current_urutan));
  const slaDueAt =
    r.status === "pending" && slaJam && cur?.notified_at
      ? new Date(new Date(cur.notified_at as string | Date).getTime() + slaJam * 3600_000).toISOString()
      : null;
  const detail: ApprovalRequestDetail = {
    id: String(r.id),
    kode: String(r.kode),
    jenis: String(r.jenis),
    jenisLabel: String(r.jenis_label),
    title: String(r.title),
    description: r.description ? String(r.description) : null,
    nominal: r.nominal != null ? Number(r.nominal) : null,
    requestedBy: String(r.requested_by),
    wilayah: isWilayah(r.wilayah) ? r.wilayah : null,
    kategori: isKategori(r.kategori) ? r.kategori : null,
    hodPengaju: r.hod_pengaju ? String(r.hod_pengaju) : null,
    refTabel: r.ref_tabel ? String(r.ref_tabel) : null,
    refId: r.ref_id ? String(r.ref_id) : null,
    status: String(r.status),
    currentUrutan: r.current_urutan != null ? Number(r.current_urutan) : null,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    slaJam,
    slaDueAt,
    slaLewat: slaDueAt !== null && new Date(slaDueAt).getTime() < Date.now(),
    steps: stepRows.map((s) => ({
      urutan: Number(s.urutan),
      label: String(s.label),
      targetType: toTargetType(s.target_type),
      hodKey: s.hod_key ? String(s.hod_key) : null,
      groupKey: s.group_key ? String(s.group_key) : null,
      status: String(s.status),
      notifiedAt: s.notified_txt ? String(s.notified_txt) : null,
      remindedAt: s.reminded_at ? String(s.reminded_at) : null,
      escalatedAt: s.escalated_at ? String(s.escalated_at) : null,
      decidedBy: s.decided_by ? String(s.decided_by) : null,
      decidedAt: s.decided_at ? String(s.decided_at) : null,
      decidedVia: s.decided_via ? String(s.decided_via) : null,
      decisionNote: s.decision_note ? String(s.decision_note) : null,
    })),
    attachments: attachmentRows.map((a) => ({
      id: Number(a.id),
      filename: String(a.filename),
      mimeType: String(a.mime_type),
      fileSize: Number(a.file_size),
      uploadedAt: String(a.uploaded_at),
    })),
  };
  if (opts.viewerUserId) {
    const viewer = await resolveApproverByUserId(opts.viewerUserId);
    if (!viewer) detail.wewenang = { boleh: false, alasan: "akun tidak aktif" };
    else if (r.status !== "pending" || !cur) detail.wewenang = { boleh: false, alasan: `request sudah ${r.status}` };
    else {
      const alasan = cekWewenang(
        { target_type: toTargetType(cur.target_type), hod_key: cur.hod_key ? String(cur.hod_key) : null, group_key: cur.group_key ? String(cur.group_key) : null },
        viewer,
        r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      );
      detail.wewenang = { boleh: alasan === null, alasan };
    }
  }
  return detail;
}

// Baca 1 lampiran dari disk (path-safe — file_path DB relatif, join di
// dalam APPROVAL_UPLOAD_ROOT, tak ada input user yg jadi path mentah).
export async function getAttachmentFile(
  requestId: string,
  attachmentId: number,
): Promise<{ buf: Buffer; mimeType: string; filename: string } | null> {
  const sql = db();
  const rows = await sql`
    SELECT filename, mime_type, file_path FROM approval_attachment
    WHERE id = ${attachmentId} AND request_id = ${requestId}
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const absPath = join(APPROVAL_UPLOAD_ROOT, String(r.file_path));
  const resolved = resolve(absPath);
  if (resolved !== APPROVAL_UPLOAD_ROOT && !resolved.startsWith(APPROVAL_UPLOAD_ROOT + "/") && !resolved.startsWith(APPROVAL_UPLOAD_ROOT + "\\")) {
    return null; // jaga-jaga, walau file_path selalu dari randomUUID() sendiri, bukan input luar
  }
  const buf = await readFile(resolved);
  return { buf, mimeType: String(r.mime_type), filename: String(r.filename) };
}

export interface ListApprovalFilter {
  status?: string;
  jenis?: string;
  // Hanya request yang tahap current-nya menunggu keputusan akun ini.
  menungguUserId?: string;
}

export async function listApprovalRequests(filter: ListApprovalFilter = {}): Promise<ApprovalRequestDetail[]> {
  const sql = db();
  let menunggu = sql`true`;
  if (filter.menungguUserId) {
    const me = await resolveApproverByUserId(filter.menungguUserId);
    if (!me) return [];
    // Cermin cekWewenang dalam SQL — supaya daftar "Menunggu Saya" tak
    // memuat request yang tombol putusnya nanti ditolak.
    menunggu = sql`
      r.status = 'pending'
      AND r.requested_by_user_id IS DISTINCT FROM ${me.userId}
      AND EXISTS (
        SELECT 1 FROM approval_step s
        WHERE s.request_id = r.id AND s.urutan = r.current_urutan AND s.status = 'pending'
          AND (
            (s.target_type = 'direktur' AND ${me.role === "direktur"})
            OR (s.target_type IN ('hod', 'hod_pengaju') AND s.hod_key IS NOT NULL AND s.hod_key = ${me.hodKey ?? ""})
            OR (s.target_type = 'grup' AND s.group_key = ANY(${sql.array(me.groups.length ? me.groups : [""])}::text[]))
          )
      )`;
  }
  const rows = await sql`
    SELECT r.id FROM approval_request r
    WHERE ${filter.status ? sql`r.status = ${filter.status}` : sql`true`}
      AND ${filter.jenis ? sql`r.jenis = ${filter.jenis}` : sql`true`}
      AND ${menunggu}
    ORDER BY r.created_at DESC LIMIT 100
  `;
  const details = await Promise.all(rows.map((r) => getApprovalRequest(String(r.id))));
  return details.filter((d): d is ApprovalRequestDetail => d !== null);
}

// ── Identitas & wewenang ───────────────────────────────────────────

// Identitas approver — dari nomor WA pengirim (#APPROVE) atau akun sesi
// (dashboard). BEDA dari resolveSender() (master.ts, roster AM) krn approver
// itu akun dashboard (app_user), bukan AM.
export interface ResolvedApprover {
  userId: string;
  name: string;
  hodKey: string | null;
  role: string;
  // access_group.key keanggotaan akun — untuk tahap target 'grup'.
  groups: string[];
}

async function muatApprover(where: "wa" | "id", nilai: string): Promise<ResolvedApprover | null> {
  const sql = db();
  const rows = await sql`
    SELECT u.id, u.name, u.hod_key, u.role,
           COALESCE(array_agg(g.key) FILTER (WHERE g.key IS NOT NULL), '{}') AS groups
    FROM app_user u
    LEFT JOIN app_user_group ug ON ug.user_id = u.id
    LEFT JOIN access_group g ON g.id = ug.group_id
    WHERE u.active = true
      AND ${where === "wa" ? sql`regexp_replace(COALESCE(u.wa_number, ''), '[^0-9]', '', 'g') = ${nilai}` : sql`u.id = ${nilai}`}
    GROUP BY u.id
    ORDER BY u.created_at
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    userId: String(r.id),
    name: r.name ? String(r.name) : "-",
    hodKey: r.hod_key ? String(r.hod_key) : null,
    role: String(r.role),
    groups: Array.isArray(r.groups) ? (r.groups as unknown[]).map(String) : [],
  };
}

// #APPROVE/#REJECT SENGAJA TIDAK ikut bypass grup uji (wa-test-bypass.ts) —
// beda dari resolveSender/matchTeknisiByName yang cuma membuka balasan
// baca/lapor, approver di sini beneran bisa memutuskan approval request
// sungguhan. Untuk tes command ini, pakai approver yang memang sudah
// terdaftar (lihat TESTCASE-WA-HASHTAG-RESEARCH.md bagian F).
export async function resolveApprover(senderJid: string | null | undefined): Promise<ResolvedApprover | null> {
  if (!senderJid) return null;
  // Pesan grup: sender_jid = group_jid (lihat inbound) — itu identitas GRUP,
  // bukan orang. Tanpa penolakan ini, akun yang wa_number-nya kebetulan berisi
  // id grup membuat SIAPA PUN di grup itu terbaca sebagai approver
  // (ketemu saat uji #OVERTIME di dev, 2026-10-11).
  if (String(senderJid).endsWith("@g.us")) return null;
  const num = String(senderJid).split("@")[0].split(":")[0];
  const norm = normalizeWa(num);
  if (!norm) return null;
  return muatApprover("wa", norm);
}

export async function resolveApproverByUserId(userId: string | null | undefined): Promise<ResolvedApprover | null> {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return muatApprover("id", userId);
}

// Pure — siapa boleh memutuskan tahap ini. null = boleh; selain itu alasan
// penolakan yang ditampilkan ke orangnya. Dipakai jalur WA DAN dashboard,
// juga dicerminkan di SQL listApprovalRequests (menungguUserId).
export function cekWewenang(
  step: { target_type: TargetType; hod_key: string | null; group_key: string | null },
  approver: Pick<ResolvedApprover, "userId" | "hodKey" | "role" | "groups">,
  requestedByUserId: string | null,
): string | null {
  // Pemisahan tugas: pengaju tak memutuskan permintaannya sendiri, walau ia
  // kebetulan pemegang tahap itu (mis. HoD mengajukan dana ops divisinya).
  if (requestedByUserId && requestedByUserId === approver.userId) {
    return "kamu yang mengajukan permintaan ini — tidak boleh memutuskannya sendiri";
  }
  switch (step.target_type) {
    case "direktur":
      return approver.role === "direktur" ? null : "tahap ini menunggu Direktur";
    case "grup":
      if (!step.group_key) return "grup approver tahap ini belum dikonfigurasi";
      return approver.groups.includes(step.group_key) ? null : `tahap ini menunggu anggota grup "${step.group_key}"`;
    case "hod":
    case "hod_pengaju":
      if (!step.hod_key) return "approver tahap ini belum ditentukan";
      return step.hod_key === approver.hodKey ? null : "bukan giliran kamu approve/reject permintaan ini";
  }
}

// ── Konsumen ───────────────────────────────────────────────────────

export interface HasilApproval {
  requestId: string;
  kode: string;
  refTabel: string;
  refId: string;
  status: "approved" | "rejected" | "canceled";
  oleh: string;
  // Akun pemutus (null untuk pembatalan dari sisi engine).
  olehUserId: string | null;
  catatan: string | null;
  // Data tambahan dari layar keputusan modul (mis. nominal disetujui klaim).
  // Kosong untuk keputusan lewat WA.
  data?: Record<string, unknown>;
}

// Dilempar penangan konsumen untuk MENOLAK keputusan dengan alasan yang
// layak dibaca pemutus (mis. "nominal nota tak terbaca — putuskan dari
// dashboard"). Transaksi keputusan batal; pemutus menerima pesannya.
export class TolakKonsumen extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TolakKonsumen";
  }
}

// Penangan modul induk. Dijalankan DI DALAM transaksi keputusan — kalau
// penangan melempar error, keputusan ikut batal (status induk & approval tak
// boleh berselisih). Jangan kirim WA dari sini; kembalikan pesannya.
export type PenanganKonsumen = (tx: Tx, hasil: HasilApproval) => Promise<void>;

// `sesudah` (opsional) jalan SETELAH transaksi keputusan commit — tempat
// efek luar seperti mengumumkan hasil ke grup WA asal pengajuan. Gagalnya
// tak membatalkan keputusan (sudah tersimpan), hanya dicatat di log.
export interface OpsiKonsumen {
  sesudah?: (hasil: HasilApproval) => Promise<void>;
}

const konsumen = new Map<string, { penangan: PenanganKonsumen; opsi: OpsiKonsumen }>();

export function daftarKonsumen(refTabel: string, penangan: PenanganKonsumen, opsi: OpsiKonsumen = {}): void {
  konsumen.set(refTabel, { penangan, opsi });
}

async function jalankanKonsumen(tx: Tx, hasil: HasilApproval): Promise<void> {
  const k = konsumen.get(hasil.refTabel);
  if (k) await k.penangan(tx, hasil);
}

async function jalankanSesudah(hasil: HasilApproval | undefined): Promise<void> {
  if (!hasil) return;
  const k = konsumen.get(hasil.refTabel);
  if (!k?.opsi.sesudah) return;
  try {
    await k.opsi.sesudah(hasil);
  } catch (e) {
    console.error(`[approval] efek sesudah keputusan ${hasil.kode} (${hasil.refTabel}) gagal:`, e);
  }
}

// ── Keputusan ──────────────────────────────────────────────────────

export interface DecideResult {
  ok: boolean;
  error?: string;
  status?: string;
  kode?: string;
  nextNotify?: NotifyResult;
}

type Kanal = "wa" | "dashboard";

// Satu jalur keputusan untuk WA & dashboard. Approver DIVALIDASI harus
// pemegang tahap CURRENT persis (bukan cuma "app_user hod/direktur mana
// saja") — cegah HoD tahap lain nyelonong approve giliran orang lain.
async function putuskan(
  where: { kode: string } | { id: string },
  action: "approve" | "reject",
  approver: ResolvedApprover,
  note: string | null,
  via: Kanal,
  data?: Record<string, unknown>,
): Promise<DecideResult> {
  if (action === "reject" && via === "dashboard" && !note?.trim()) {
    return { ok: false, error: "alasan penolakan wajib diisi" };
  }
  const sql = db();
  // Satu transaksi + kunci baris request (FOR UPDATE): webhook yang terkirim
  // ulang / balasan dobel tak bisa memajukan tahap dua kali (pola race F60,
  // uji dev 11 Okt 2026). Kirim WA SESUDAH commit.
  type Out = DecideResult & {
    notifyNext?: boolean; tellWa?: string; tellMsg?: string; requestId?: string; urutan?: number; hasil?: HasilApproval;
  };
  const jalankan = () => sql.begin(async (txRaw): Promise<Out> => {
    const tx = txRaw as unknown as Tx;
    const [req] =
      "kode" in where
        ? await tx`SELECT id, kode, status, current_urutan, requested_by_wa, requested_by_user_id, title, ref_tabel, ref_id FROM approval_request WHERE kode = ${where.kode} FOR UPDATE`
        : await tx`SELECT id, kode, status, current_urutan, requested_by_wa, requested_by_user_id, title, ref_tabel, ref_id FROM approval_request WHERE id = ${where.id} FOR UPDATE`;
    if (!req) return { ok: false, error: "kode" in where ? `kode "${where.kode}" tidak ditemukan` : "permintaan tidak ditemukan" };
    const kode = String(req.kode);
    if (req.status !== "pending") return { ok: false, error: `request ini sudah ${req.status}` };

    const [step] = await tx`SELECT id, urutan, target_type, hod_key, group_key, status FROM approval_step WHERE request_id = ${req.id} AND urutan = ${req.current_urutan}`;
    if (!step || step.status !== "pending") return { ok: false, error: "tahap current tidak valid" };

    const tolak = cekWewenang(
      { target_type: toTargetType(step.target_type), hod_key: step.hod_key ? String(step.hod_key) : null, group_key: step.group_key ? String(step.group_key) : null },
      approver,
      req.requested_by_user_id ? String(req.requested_by_user_id) : null,
    );
    if (tolak) return { ok: false, error: tolak };

    const wa = req.requested_by_wa ? String(req.requested_by_wa) : undefined;
    const ref = req.ref_tabel ? { refTabel: String(req.ref_tabel), refId: String(req.ref_id) } : null;
    const base = { requestId: String(req.id), kode, oleh: approver.name, olehUserId: approver.userId, catatan: note ?? null, data };

    if (action === "reject") {
      await tx`UPDATE approval_step SET status = 'rejected', decided_by = ${approver.name}, decided_by_user_id = ${approver.userId}, decided_via = ${via}, decided_at = now(), decision_note = ${note ?? null} WHERE id = ${step.id}`;
      await tx`UPDATE approval_request SET status = 'rejected', decided_at = now() WHERE id = ${req.id}`;
      const hasil: HasilApproval | undefined = ref ? { ...base, ...ref, status: "rejected" } : undefined;
      if (hasil) await jalankanKonsumen(tx, hasil);
      return {
        ok: true, status: "rejected", kode, requestId: String(req.id), urutan: Number(step.urutan), tellWa: wa, hasil,
        tellMsg: `❌ Permintaan "${req.title}" (${kode}) DITOLAK oleh ${approver.name}${note ? `: ${note}` : ""}.`,
      };
    }

    await tx`UPDATE approval_step SET status = 'approved', decided_by = ${approver.name}, decided_by_user_id = ${approver.userId}, decided_via = ${via}, decided_at = now(), decision_note = ${note ?? null} WHERE id = ${step.id}`;
    // Tahap berikut = urutan pending terkecil sesudah tahap ini — urutan
    // boleh berlubang (tahap nonaktif tak dibuatkan langkah).
    const [{ next_urutan }] = await tx`
      SELECT min(urutan) AS next_urutan FROM approval_step
      WHERE request_id = ${req.id} AND urutan > ${step.urutan} AND status = 'pending'
    `;
    if (next_urutan == null) {
      await tx`UPDATE approval_request SET status = 'approved', decided_at = now() WHERE id = ${req.id}`;
      const hasil: HasilApproval | undefined = ref ? { ...base, ...ref, status: "approved" } : undefined;
      if (hasil) await jalankanKonsumen(tx, hasil);
      return {
        ok: true, status: "approved", kode, requestId: String(req.id), urutan: Number(step.urutan), tellWa: wa, hasil,
        tellMsg: `✅ Permintaan "${req.title}" (${kode}) DISETUJUI semua tahap.`,
      };
    }
    await tx`UPDATE approval_request SET current_urutan = ${Number(next_urutan)} WHERE id = ${req.id}`;
    return { ok: true, status: "pending", kode, requestId: String(req.id), urutan: Number(step.urutan), notifyNext: true };
  });
  let out: Out;
  try {
    out = await jalankan();
  } catch (e) {
    if (e instanceof TolakKonsumen) return { ok: false, error: e.message };
    throw e;
  }
  if (!out.ok) return { ok: false, error: out.error };

  await logAudit(
    out.status === "rejected" ? "approval.reject" : "approval.approve",
    approver.name,
    { request_id: out.requestId, kode: out.kode, urutan: out.urutan, note, via },
    out.status === "rejected" ? "reject" : "approve",
  );
  if (out.tellWa && out.tellMsg) await sendViaWaGateway(out.tellWa, out.tellMsg);
  await jalankanSesudah(out.hasil);
  if (out.notifyNext && out.requestId) {
    const nextNotify = await notifyCurrentStep(out.requestId);
    return { ok: true, status: "pending", kode: out.kode, nextNotify };
  }
  return { ok: true, status: out.status, kode: out.kode };
}

// #APPROVE/#REJECT <kode> [alasan] dari WA privat.
export async function decideCurrentStep(
  kode: string,
  action: "approve" | "reject",
  approver: ResolvedApprover,
  note?: string | null,
): Promise<DecideResult> {
  return putuskan({ kode }, action, approver, note ?? null, "wa");
}

// Keputusan dari dashboard. userId WAJIB dari sesi (BFF), bukan body klien.
export async function decideFromDashboard(
  requestId: string,
  action: "approve" | "reject",
  userId: string,
  note?: string | null,
  data?: Record<string, unknown>,
): Promise<DecideResult> {
  const approver = await resolveApproverByUserId(userId);
  if (!approver) return { ok: false, error: "akun tidak dikenal atau tidak aktif" };
  return putuskan({ id: requestId }, action, approver, note?.trim() || null, "dashboard", data);
}

// Ganti HoD pemegang tahap CURRENT yang masih menunggu — untuk modul yang
// HoD pengajunya baru diketahui/dikoreksi belakangan (mis. lembur: admin
// menetapkan HoD divisi). Hanya tahap ber-target hod/hod_pengaju; jejak SLA
// direset karena notifikasi ke orang baru dimulai dari nol. Pemanggil yang
// menentukan siapa boleh mengganti; WA ke HoD baru dikirim di sini.
export async function gantiHodTahapCurrent(
  requestId: string,
  hodKey: string,
  oleh: string,
): Promise<{ ok: boolean; error?: string; notify?: NotifyResult }> {
  const key = hodKey.trim();
  if (!key) return { ok: false, error: "hod_key kosong" };
  const sql = db();
  const out = await sql.begin(async (txRaw): Promise<{ ok: boolean; error?: string; lama?: string | null }> => {
    const tx = txRaw as unknown as Tx;
    const [req] = await tx`SELECT id, kode, status, current_urutan FROM approval_request WHERE id = ${requestId} FOR UPDATE`;
    if (!req) return { ok: false, error: "request tidak ditemukan" };
    if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };
    const [step] = await tx`SELECT id, target_type, hod_key, status FROM approval_step WHERE request_id = ${req.id} AND urutan = ${req.current_urutan}`;
    if (!step || step.status !== "pending") return { ok: false, error: "tahap current tidak valid" };
    if (step.target_type !== "hod" && step.target_type !== "hod_pengaju") {
      return { ok: false, error: `tahap sekarang ber-target "${step.target_type}", bukan HoD` };
    }
    await tx`UPDATE approval_step SET hod_key = ${key}, notified_at = NULL, reminded_at = NULL, escalated_at = NULL WHERE id = ${step.id}`;
    if (step.target_type === "hod_pengaju") await tx`UPDATE approval_request SET hod_pengaju = ${key} WHERE id = ${req.id}`;
    return { ok: true, lama: step.hod_key ? String(step.hod_key) : null };
  });
  if (!out.ok) return { ok: false, error: out.error };
  await logAudit("approval.reassign", oleh, { request_id: requestId, dari: out.lama, ke: key }, "update");
  return { ok: true, notify: await notifyCurrentStep(requestId) };
}

// Batalkan request yang masih berjalan — dipakai modul konsumen saat baris
// induknya dihapus/ditarik pengaju. Penangan konsumen ikut dipanggil supaya
// status induk konsisten bila pembatalan datang dari sisi approval.
export async function batalkanRequestDalamTx(
  tx: Tx,
  where: { id: string } | { refTabel: string; refId: string },
  oleh: string,
  alasan: string | null,
): Promise<{ ok: boolean; kode?: string; error?: string }> {
  const [req] =
    "id" in where
      ? await tx`SELECT id, kode, status, ref_tabel, ref_id FROM approval_request WHERE id = ${where.id} FOR UPDATE`
      : await tx`SELECT id, kode, status, ref_tabel, ref_id FROM approval_request WHERE ref_tabel = ${where.refTabel} AND ref_id = ${where.refId} AND status = 'pending' FOR UPDATE`;
  if (!req) return { ok: false, error: "tidak ada approval berjalan" };
  if (req.status !== "pending") return { ok: false, error: `request sudah ${req.status}` };
  await tx`UPDATE approval_step SET status = 'skipped' WHERE request_id = ${req.id} AND status = 'pending'`;
  await tx`UPDATE approval_request SET status = 'canceled', decided_at = now() WHERE id = ${req.id}`;
  // Pembatalan yang datang DARI modul induk tak perlu memanggil balik
  // penangannya (induk sudah tahu); yang datang dari sisi approval perlu.
  if ("id" in where && req.ref_tabel) {
    await jalankanKonsumen(tx, {
      requestId: String(req.id), kode: String(req.kode), refTabel: String(req.ref_tabel), refId: String(req.ref_id),
      status: "canceled", oleh, olehUserId: null, catatan: alasan,
    });
  }
  return { ok: true, kode: String(req.kode) };
}

// ── SLA ────────────────────────────────────────────────────────────

export type AksiSla = "ingatkan" | "eskalasi" | null;

// Pure — aksi SLA untuk tahap current. Batas pertama (sla_jam sejak
// notifikasi) = pengingat ke approver; batas kedua (2× sla_jam) = eskalasi.
// Masing-masing sekali per notifikasi (kirim ulang manual mereset jejaknya).
export function aksiSla(
  t: { notifiedAt: Date | null; remindedAt: Date | null; escalatedAt: Date | null },
  slaJam: number | null,
  eskalasi: boolean,
  now: Date,
): AksiSla {
  if (!slaJam || !t.notifiedAt) return null;
  const lewatJam = (now.getTime() - t.notifiedAt.getTime()) / 3600_000;
  if (eskalasi && lewatJam >= 2 * slaJam && !t.escalatedAt) return "eskalasi";
  if (lewatJam >= slaJam && !t.remindedAt && !t.escalatedAt) return "ingatkan";
  return null;
}

export interface HasilSla {
  diperiksa: number;
  diingatkan: number;
  dieskalasi: number;
  gagal: string[];
}

// Job terjadwal (scheduler 'approval-sla', default mati). Hanya memeriksa
// tahap yang SUDAH dinotifikasi — tahap yang notifikasinya gagal tak punya
// awal hitungan dan sudah tampil sebagai error di halaman detail.
export async function runApprovalSla(now: Date = new Date()): Promise<HasilSla> {
  const sql = db();
  const rows = await sql`
    SELECT r.id, r.kode, r.title, r.requested_by, r.requested_by_wa, r.requested_by_user_id, a.sla_jam, a.eskalasi,
           s.id AS step_id, s.label, s.target_type, s.notified_at, s.reminded_at, s.escalated_at
    FROM approval_request r
    JOIN approval_alur a ON a.jenis = r.jenis
    JOIN approval_step s ON s.request_id = r.id AND s.urutan = r.current_urutan
    WHERE r.status = 'pending' AND s.status = 'pending' AND a.sla_jam IS NOT NULL AND s.notified_at IS NOT NULL
  `;
  const hasil: HasilSla = { diperiksa: rows.length, diingatkan: 0, dieskalasi: 0, gagal: [] };
  const url = appUrl();
  for (const r of rows) {
    const aksi = aksiSla(
      {
        notifiedAt: new Date(r.notified_at as string | Date),
        remindedAt: r.reminded_at ? new Date(r.reminded_at as string | Date) : null,
        escalatedAt: r.escalated_at ? new Date(r.escalated_at as string | Date) : null,
      },
      Number(r.sla_jam),
      r.eskalasi === true,
      now,
    );
    if (!aksi) continue;
    const link = url ? `\n${url}/approval-requests/${r.id}` : "";
    if (aksi === "ingatkan") {
      const ctx = await muatTahapCurrent(String(r.id));
      if ("error" in ctx) {
        hasil.gagal.push(`${r.kode}: ${ctx.error}`);
        continue;
      }
      const msg =
        `⏰ *Pengingat Approval* (${r.label})\n\n${r.title}\nDiajukan oleh: ${r.requested_by}\n` +
        `Sudah lewat ${r.sla_jam} jam tanpa keputusan.\n\n` +
        `Balas *#APPROVE ${r.kode}* atau *#REJECT ${r.kode} ALASAN*.${link}`;
      const kirim = await kirimKeTarget(ctx.targets, msg);
      if (kirim.terkirim.length === 0) {
        hasil.gagal.push(`${r.kode}: ${kirim.gagal.join("; ")}`);
        continue;
      }
      await sql`UPDATE approval_step SET reminded_at = now() WHERE id = ${r.step_id}`;
      hasil.diingatkan++;
      continue;
    }
    // Eskalasi: ke Direktur (kecuali tahapnya memang menunggu Direktur —
    // eskalasi ke dirinya sendiri tak berguna) + kabar ke pengaju.
    const msg =
      `🚨 *Eskalasi Approval* — ${r.kode}\n\n${r.title}\nDiajukan oleh: ${r.requested_by}\n` +
      `Tahap "${r.label}" sudah lewat ${2 * Number(r.sla_jam)} jam tanpa keputusan.${link}`;
    const sasaran: ResolvedTarget[] = [];
    if (r.target_type !== "direktur") {
      const [d] = await sql`SELECT name, wa_number FROM app_user WHERE role = 'direktur' AND active = true AND wa_number IS NOT NULL AND wa_number <> '' ORDER BY created_at LIMIT 1`;
      if (d) sasaran.push({ waNumber: String(d.wa_number), name: String(d.name ?? "Direktur") });
    } else {
      const ctx = await muatTahapCurrent(String(r.id));
      if (!("error" in ctx)) sasaran.push(...ctx.targets);
    }
    if (r.requested_by_wa) sasaran.push({ waNumber: String(r.requested_by_wa), name: String(r.requested_by) });
    const kirim = await kirimKeTarget(sasaran, msg);
    if (kirim.terkirim.length === 0) {
      hasil.gagal.push(`${r.kode}: eskalasi tak terkirim${kirim.gagal.length ? ` — ${kirim.gagal.join("; ")}` : " (tak ada penerima)"}`);
      continue;
    }
    await sql`UPDATE approval_step SET escalated_at = now() WHERE id = ${r.step_id}`;
    await logAudit("approval.escalate", null, { request_id: String(r.id), kode: r.kode, label: r.label }, "escalate");
    hasil.dieskalasi++;
  }
  return hasil;
}
