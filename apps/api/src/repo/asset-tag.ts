import { db } from "../db.js";

// F53 — Stiker Aset & Asset Tagging Audit (OPS). Registry aset yang ditag
// QR-code (bukan katalog aset lengkap — itu F132, masih blocked). `kode`
// diisi manual (skema WRG-<lokasi>-<kategori>-<urut>, tapi tak ada aturan
// generate resmi). Audit = riwayat verifikasi fisik berkala.

const toIsoTs = (x: unknown): string => new Date(x as string | Date).toISOString();

export interface AssetTagRow {
  id: string;
  kode: string;
  nama: string;
  jenis_kepemilikan: string;
  kategori: string | null;
  lokasi_cabang: string | null;
  letak: string | null;
  foto_path: string | null;
  active: boolean;
  last_audit_at: string | null;
  last_audit_found: boolean | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): AssetTagRow {
  return {
    id: String(r.id),
    kode: String(r.kode),
    nama: String(r.nama),
    jenis_kepemilikan: String(r.jenis_kepemilikan),
    kategori: r.kategori ? String(r.kategori) : null,
    lokasi_cabang: r.lokasi_cabang ? String(r.lokasi_cabang) : null,
    letak: r.letak ? String(r.letak) : null,
    foto_path: r.foto_path ? String(r.foto_path) : null,
    active: Boolean(r.active),
    last_audit_at: r.last_audit_at ? toIsoTs(r.last_audit_at) : null,
    last_audit_found: r.last_audit_found == null ? null : Boolean(r.last_audit_found),
    created_at: toIsoTs(r.created_at),
    updated_at: toIsoTs(r.updated_at),
  };
}

export async function listAssetTags(activeOnly = true): Promise<AssetTagRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT a.*, la.audited_at AS last_audit_at, la.found AS last_audit_found
    FROM asset_tag a
    LEFT JOIN LATERAL (
      SELECT audited_at, found FROM asset_tag_audit_log
      WHERE asset_tag_id = a.id ORDER BY audited_at DESC LIMIT 1
    ) la ON true
    WHERE ${activeOnly ? sql`a.active = true` : sql`true`}
    ORDER BY a.kode ASC
  `;
  return rows.map(mapRow);
}

export interface AssetTagInput {
  kode: string;
  nama: string;
  jenis_kepemilikan?: "aset" | "inventaris";
  kategori?: string | null;
  lokasi_cabang?: string | null;
  letak?: string | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createAssetTag(input: AssetTagInput): Promise<AssetTagRow | ActionResult> {
  const sql = db();
  const kode = input.kode.trim();
  const nama = input.nama.trim();
  if (!kode || !nama) return { ok: false, error: "kode & nama wajib diisi" };
  const existing = await sql`SELECT 1 FROM asset_tag WHERE kode = ${kode} LIMIT 1`;
  if (existing.length > 0) return { ok: false, error: `kode "${kode}" sudah dipakai` };
  const rows = await sql`
    INSERT INTO asset_tag (kode, nama, jenis_kepemilikan, kategori, lokasi_cabang, letak)
    VALUES (${kode}, ${nama}, ${input.jenis_kepemilikan ?? "aset"}, ${input.kategori ?? null}, ${input.lokasi_cabang ?? null}, ${input.letak ?? null})
    RETURNING *
  `;
  return mapRow({ ...rows[0], last_audit_at: null, last_audit_found: null });
}

export interface AssetTagUpdateInput {
  nama?: string | null;
  jenis_kepemilikan?: "aset" | "inventaris" | null;
  kategori?: string | null;
  lokasi_cabang?: string | null;
  letak?: string | null;
  active?: boolean | null;
}

export async function updateAssetTag(id: string, input: AssetTagUpdateInput): Promise<ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id FROM asset_tag WHERE id = ${id}`;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  await sql`
    UPDATE asset_tag SET
      nama = COALESCE(${input.nama ?? null}, nama),
      jenis_kepemilikan = COALESCE(${input.jenis_kepemilikan ?? null}, jenis_kepemilikan),
      kategori = COALESCE(${input.kategori ?? null}, kategori),
      lokasi_cabang = COALESCE(${input.lokasi_cabang ?? null}, lokasi_cabang),
      letak = COALESCE(${input.letak ?? null}, letak),
      active = COALESCE(${input.active ?? null}, active),
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: true };
}

export interface AssetTagAuditRow {
  id: string;
  asset_tag_id: string;
  audited_by: string;
  audited_at: string;
  found: boolean;
  note: string | null;
}

function mapAuditRow(r: Record<string, unknown>): AssetTagAuditRow {
  return {
    id: String(r.id),
    asset_tag_id: String(r.asset_tag_id),
    audited_by: String(r.audited_by),
    audited_at: toIsoTs(r.audited_at),
    found: Boolean(r.found),
    note: r.note ? String(r.note) : null,
  };
}

export async function listAuditLog(assetTagId: string, limit = 50): Promise<AssetTagAuditRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT * FROM asset_tag_audit_log WHERE asset_tag_id = ${assetTagId}
    ORDER BY audited_at DESC LIMIT ${limit}
  `;
  return rows.map(mapAuditRow);
}

export interface AssetTagAuditInput {
  audited_by: string;
  found: boolean;
  note?: string | null;
}

export async function recordAudit(assetTagId: string, input: AssetTagAuditInput): Promise<AssetTagAuditRow | ActionResult> {
  const sql = db();
  const audited_by = input.audited_by.trim();
  if (!audited_by) return { ok: false, error: "audited_by wajib diisi" };
  const asset = await sql`SELECT id FROM asset_tag WHERE id = ${assetTagId}`;
  if (asset.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  const rows = await sql`
    INSERT INTO asset_tag_audit_log (asset_tag_id, audited_by, found, note)
    VALUES (${assetTagId}, ${audited_by}, ${input.found}, ${input.note ?? null})
    RETURNING *
  `;
  return mapAuditRow(rows[0]);
}
