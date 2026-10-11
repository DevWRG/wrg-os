import { db } from "../db.js";

// F44 Document Print Spec Standardizer (Shipping) — master data standalone,
// TANPA FK ke tabel manapun (lihat komentar migrasi 096). document_type teks
// bebas (unique case-insensitive) supaya bisa mencakup dokumen shipping yang
// belum ada tabelnya (SJ/BAST/TTF — branch F12/F42/F45/F93 belum merge) maupun
// dokumen lain yang sudah ada (dicatat sebagai label saja, tanpa menyentuh
// tabel/domain aslinya). is_active dipakai untuk retire tanpa hapus (pola sama
// F134 ATK Master). date/timestamptz eksplisit ::text di SELECT/RETURNING
// (gotcha postgres.js yang sama di semua repo lain).

export class PrintSpecError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PrintSpecError";
  }
}

export const PAPER_SIZES = ["A4", "A5", "A6", "F4", "Letter"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];
export const isValidPaperSize = (s: unknown): s is PaperSize =>
  typeof s === "string" && (PAPER_SIZES as readonly string[]).includes(s);

export const ORIENTATIONS = ["portrait", "landscape"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const isValidOrientation = (s: unknown): s is Orientation =>
  typeof s === "string" && (ORIENTATIONS as readonly string[]).includes(s);

export interface PrintSpecRow {
  id: string;
  document_type: string;
  paper_size: PaperSize;
  orientation: Orientation;
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  font_family: string;
  font_size_pt: number;
  has_letterhead: boolean;
  header_spec: string | null;
  footer_spec: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>): PrintSpecRow {
  return {
    id: String(r.id),
    document_type: String(r.document_type),
    paper_size: r.paper_size as PaperSize,
    orientation: r.orientation as Orientation,
    margin_top_mm: Number(r.margin_top_mm),
    margin_right_mm: Number(r.margin_right_mm),
    margin_bottom_mm: Number(r.margin_bottom_mm),
    margin_left_mm: Number(r.margin_left_mm),
    font_family: String(r.font_family),
    font_size_pt: Number(r.font_size_pt),
    has_letterhead: Boolean(r.has_letterhead),
    header_spec: r.header_spec != null ? String(r.header_spec) : null,
    footer_spec: r.footer_spec != null ? String(r.footer_spec) : null,
    notes: r.notes != null ? String(r.notes) : null,
    is_active: Boolean(r.is_active),
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function cols(sql: ReturnType<typeof db>) {
  return sql`
    id, document_type, paper_size, orientation,
    margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm,
    font_family, font_size_pt, has_letterhead, header_spec, footer_spec,
    notes, is_active, created_by, created_at::text, updated_at::text
  `;
}

function isDuplicateDocType(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /print_spec_document_type_lower_idx|duplicate key/.test(msg);
}

function validateMargin(name: string, v: number | undefined): void {
  if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
    throw new PrintSpecError(400, `${name} tidak valid (harus angka >= 0)`);
  }
}

export interface PrintSpecInput {
  document_type: string;
  paper_size?: PaperSize;
  orientation?: Orientation;
  margin_top_mm?: number;
  margin_right_mm?: number;
  margin_bottom_mm?: number;
  margin_left_mm?: number;
  font_family?: string;
  font_size_pt?: number;
  has_letterhead?: boolean;
  header_spec?: string | null;
  footer_spec?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

function validateInput(t: PrintSpecInput | PrintSpecPatch): void {
  if (t.paper_size !== undefined && !isValidPaperSize(t.paper_size)) {
    throw new PrintSpecError(400, "paper_size tidak valid (A4/A5/A6/F4/Letter)");
  }
  if (t.orientation !== undefined && !isValidOrientation(t.orientation)) {
    throw new PrintSpecError(400, "orientation tidak valid (portrait/landscape)");
  }
  validateMargin("margin_top_mm", t.margin_top_mm);
  validateMargin("margin_right_mm", t.margin_right_mm);
  validateMargin("margin_bottom_mm", t.margin_bottom_mm);
  validateMargin("margin_left_mm", t.margin_left_mm);
  if (t.font_size_pt !== undefined && (!Number.isFinite(t.font_size_pt) || t.font_size_pt <= 0)) {
    throw new PrintSpecError(400, "font_size_pt tidak valid (harus > 0)");
  }
}

export async function createPrintSpec(t: PrintSpecInput): Promise<PrintSpecRow> {
  if (!t.document_type?.trim()) throw new PrintSpecError(400, "document_type wajib diisi");
  validateInput(t);
  const sql = db();
  try {
    const rows = await sql`
      INSERT INTO print_spec (
        document_type, paper_size, orientation,
        margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm,
        font_family, font_size_pt, has_letterhead, header_spec, footer_spec,
        notes, created_by
      ) VALUES (
        ${t.document_type.trim()}, ${t.paper_size ?? "A4"}, ${t.orientation ?? "portrait"},
        ${t.margin_top_mm ?? 20}, ${t.margin_right_mm ?? 20}, ${t.margin_bottom_mm ?? 20}, ${t.margin_left_mm ?? 20},
        ${t.font_family ?? "Arial"}, ${t.font_size_pt ?? 11}, ${t.has_letterhead ?? true},
        ${t.header_spec ?? null}, ${t.footer_spec ?? null}, ${t.notes ?? null}, ${t.created_by ?? null}
      )
      RETURNING id
    `;
    const created = await getPrintSpec(String(rows[0].id));
    if (!created) throw new Error("gagal membaca print spec setelah dibuat");
    return created;
  } catch (e) {
    if (isDuplicateDocType(e)) {
      throw new PrintSpecError(409, `Jenis dokumen "${t.document_type.trim()}" sudah punya spec cetak`);
    }
    throw e;
  }
}

export async function listPrintSpecs(opts?: { isActive?: boolean }): Promise<PrintSpecRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT ${cols(sql)}
    FROM print_spec
    WHERE ${opts?.isActive !== undefined ? sql`is_active = ${opts.isActive}` : sql`true`}
    ORDER BY document_type ASC
  `;
  return rows.map(mapRow);
}

export async function getPrintSpec(id: string): Promise<PrintSpecRow | null> {
  const sql = db();
  const rows = await sql`SELECT ${cols(sql)} FROM print_spec WHERE id = ${id}`;
  return rows.length ? mapRow(rows[0]) : null;
}

export interface PrintSpecPatch {
  document_type?: string;
  paper_size?: PaperSize;
  orientation?: Orientation;
  margin_top_mm?: number;
  margin_right_mm?: number;
  margin_bottom_mm?: number;
  margin_left_mm?: number;
  font_family?: string;
  font_size_pt?: number;
  has_letterhead?: boolean;
  header_spec?: string | null;
  footer_spec?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function updatePrintSpec(id: string, patch: PrintSpecPatch): Promise<PrintSpecRow> {
  if (patch.document_type !== undefined && !patch.document_type.trim()) {
    throw new PrintSpecError(400, "document_type tidak boleh kosong");
  }
  validateInput(patch);
  const existing = await getPrintSpec(id);
  if (!existing) throw new PrintSpecError(404, "print spec tidak ditemukan");

  const next = {
    document_type: patch.document_type?.trim() ?? existing.document_type,
    paper_size: patch.paper_size ?? existing.paper_size,
    orientation: patch.orientation ?? existing.orientation,
    margin_top_mm: patch.margin_top_mm ?? existing.margin_top_mm,
    margin_right_mm: patch.margin_right_mm ?? existing.margin_right_mm,
    margin_bottom_mm: patch.margin_bottom_mm ?? existing.margin_bottom_mm,
    margin_left_mm: patch.margin_left_mm ?? existing.margin_left_mm,
    font_family: patch.font_family?.trim() || existing.font_family,
    font_size_pt: patch.font_size_pt ?? existing.font_size_pt,
    has_letterhead: patch.has_letterhead ?? existing.has_letterhead,
    header_spec: patch.header_spec !== undefined ? patch.header_spec : existing.header_spec,
    footer_spec: patch.footer_spec !== undefined ? patch.footer_spec : existing.footer_spec,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    is_active: patch.is_active ?? existing.is_active,
  };

  const sql = db();
  try {
    await sql`
      UPDATE print_spec SET
        document_type = ${next.document_type},
        paper_size = ${next.paper_size},
        orientation = ${next.orientation},
        margin_top_mm = ${next.margin_top_mm},
        margin_right_mm = ${next.margin_right_mm},
        margin_bottom_mm = ${next.margin_bottom_mm},
        margin_left_mm = ${next.margin_left_mm},
        font_family = ${next.font_family},
        font_size_pt = ${next.font_size_pt},
        has_letterhead = ${next.has_letterhead},
        header_spec = ${next.header_spec},
        footer_spec = ${next.footer_spec},
        notes = ${next.notes},
        is_active = ${next.is_active},
        updated_at = now()
      WHERE id = ${id}
    `;
  } catch (e) {
    if (isDuplicateDocType(e)) {
      throw new PrintSpecError(409, `Jenis dokumen "${next.document_type}" sudah punya spec cetak`);
    }
    throw e;
  }
  const updated = await getPrintSpec(id);
  if (!updated) throw new Error("gagal membaca print spec setelah update");
  return updated;
}

export async function deletePrintSpec(id: string): Promise<{ deleted: number }> {
  const sql = db();
  const rows = await sql`DELETE FROM print_spec WHERE id = ${id} RETURNING id`;
  return { deleted: rows.length };
}
