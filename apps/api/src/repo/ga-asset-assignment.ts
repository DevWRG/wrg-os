import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { normalizeWa } from "./master.js";
import { getAsset, resolveUserByName, type GaAssetRow } from "./ga-asset.js";

// F133 — GA Asset Assignment + Transfer + History Timeline. DI ATAS F132
// (ga_assets, migrasi 086) — assign/return/transfer SUNGGUHAN (yang menulis
// histori) ada di sini; repo/ga-asset.ts cuma CRUD dasar + override PIC
// manual cepat tanpa histori.
//
// PIC WAJIB user terdaftar (app_user.id) di tabel histori — assign via nama
// bebas yang TIDAK match user terdaftar tetap didukung tapi TIDAK
// menghasilkan baris histori (trade-off diadopsi dari source gais).

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const wibToday = (): string => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

// Log ke audit_log (governance D6, migrasi 002) sbg Layer 5 = Human (lihat
// komentar kolom `layer` di schema) — beda dari insertAuditEvent/EventEnvelope
// (repo/audit.ts) yang khusus pipeline ingestion ADR-024 Layer 2 (Input).
// agent_id sengaja NULL (bukan run AI-agent, FK ke agent_registry kalau
// diisi wajib ada baris terdaftar). Best-effort — gagal audit TIDAK boleh
// gagalkan aksi assign/return/transfer itu sendiri.
async function logAudit(eventType: string, payload: Record<string, unknown>, humanActor?: string | null): Promise<void> {
  try {
    const sql = db();
    await sql`
      INSERT INTO audit_log (use_case_id, layer, event_type, r_tier, payload, human_actor)
      VALUES ('F133', 5, ${eventType}, 'R1', ${sql.json(payload as Parameters<typeof sql.json>[0])}, ${humanActor ?? null})
    `;
  } catch {
    // best-effort, jangan sampai gagal audit menggagalkan aksi utamanya
  }
}

// Notif WA one-shot (bukan cron berulang, jadi tak perlu penanda anti-spam
// spt F37/F45/F50 — cukup best-effort, gagal kirim tak boleh gagalkan
// assign/transfer-nya sendiri, lihat caller `.catch(() => {})`).
async function notifyPic(userId: string, assetCode: string, assetNama: string, kind: "assign" | "transfer"): Promise<void> {
  const sql = db();
  const [u] = await sql`SELECT wa_number, name FROM app_user WHERE id = ${userId}`;
  if (!u) return;
  const verb = kind === "assign" ? "di-assign ke kamu" : "di-transfer ke kamu";
  const msg = [
    "📦 *Aset GA*",
    `${assetCode} — ${assetNama} ${verb}.`,
    u.name ? `PIC: ${u.name}` : null,
  ].filter(Boolean).join("\n");
  const targets = [u.wa_number, process.env.GA_ASSET_NOTIFY_CC || null].filter((t): t is string => !!t);
  for (const t of targets) {
    await sendViaWaGateway(normalizeWa(t), msg);
  }
}

// ───────────────────────── Assign ─────────────────────────

export interface AssignInput {
  user_id?: string | null;
  pic_name?: string | null;
  department?: string | null;
  assigned_date?: string | null;
  notes?: string | null;
}

export async function assignAsset(assetId: string, input: AssignInput): Promise<GaAssetRow | ActionResult> {
  const sql = db();
  const picNameTrim = input.pic_name?.trim() || null;
  if (!input.user_id && !picNameTrim) return { ok: false, error: "user_id atau pic_name wajib diisi" };

  const rows = await sql`
    SELECT a.id, a.asset_code, a.nama, a.current_pic_user_id, a.pic_name_override, c.is_shared
    FROM ga_assets a JOIN ga_asset_categories c ON c.id = a.category_id
    WHERE a.id = ${assetId}
  `;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  const asset = rows[0];

  if (!asset.is_shared) {
    const active = await sql`SELECT 1 FROM ga_asset_assignments WHERE asset_id = ${assetId} AND returned_date IS NULL LIMIT 1`;
    if (active.length > 0 || asset.current_pic_user_id || asset.pic_name_override) {
      return { ok: false, error: "aset sudah di-assign — return dulu sebelum assign ulang (atau tandai kategori ini shared)" };
    }
  }

  let userId = input.user_id ?? null;
  if (!userId && picNameTrim) userId = await resolveUserByName(picNameTrim);

  if (userId) {
    await sql`
      INSERT INTO ga_asset_assignments (asset_id, user_id, department, assigned_date, notes, is_shared_snapshot)
      VALUES (${assetId}, ${userId}, ${input.department ?? null}, ${input.assigned_date ?? wibToday()}, ${input.notes ?? null}, ${Boolean(asset.is_shared)})
    `;
    await sql`UPDATE ga_assets SET current_pic_user_id = ${userId}, pic_name_override = NULL, department = COALESCE(${input.department ?? null}, department), updated_at = now() WHERE id = ${assetId}`;
    await notifyPic(userId, String(asset.asset_code), String(asset.nama), "assign").catch(() => {});
    await logAudit("ga_asset.assign", { asset_id: assetId, asset_code: asset.asset_code, user_id: userId, department: input.department ?? null });
  } else {
    // Free-text tanpa match user terdaftar — TANPA baris histori (lihat header),
    // tapi TETAP di-log ke audit_log (governance-nya lebih luas dari histori F133 sendiri).
    await sql`UPDATE ga_assets SET current_pic_user_id = NULL, pic_name_override = ${picNameTrim}, updated_at = now() WHERE id = ${assetId}`;
    await logAudit("ga_asset.assign_freetext", { asset_id: assetId, asset_code: asset.asset_code, pic_name: picNameTrim });
  }
  return (await getAsset(assetId))!;
}

// ───────────────────────── Return ─────────────────────────

export interface ReturnInput {
  assignment_id?: string | null;
  user_id?: string | null;
  returned_date?: string | null;
  notes?: string | null;
}

export async function returnAsset(assetId: string, input: ReturnInput): Promise<ActionResult> {
  const sql = db();
  let active;
  if (input.assignment_id) {
    active = await sql`SELECT id FROM ga_asset_assignments WHERE id = ${input.assignment_id} AND asset_id = ${assetId} AND returned_date IS NULL`;
  } else if (input.user_id) {
    active = await sql`SELECT id FROM ga_asset_assignments WHERE asset_id = ${assetId} AND user_id = ${input.user_id} AND returned_date IS NULL`;
  } else {
    active = await sql`SELECT id FROM ga_asset_assignments WHERE asset_id = ${assetId} AND returned_date IS NULL`;
  }
  if (active.length === 0) {
    // Mungkin cuma pic_name_override (free-text, tak punya baris histori) — return-nya cukup kosongkan cache.
    const [asset] = await sql`SELECT pic_name_override FROM ga_assets WHERE id = ${assetId}`;
    if (asset?.pic_name_override) {
      await sql`UPDATE ga_assets SET current_pic_user_id = NULL, pic_name_override = NULL, updated_at = now() WHERE id = ${assetId}`;
      await logAudit("ga_asset.return_freetext", { asset_id: assetId });
      return { ok: true };
    }
    return { ok: false, error: "tidak ada assignment aktif yang cocok" };
  }
  if (active.length > 1) return { ok: false, error: "lebih dari 1 assignment aktif (kategori shared) — sebutkan assignment_id atau user_id" };

  const returnedDate = input.returned_date ?? wibToday();
  // returned_at (timestamptz, beda dari returned_date yg cuma tanggal) —
  // dipakai getAssetHistory() utk urutkan kronologis SUNGGUHAN kalau ada
  // event lain (assign/transfer) di hari kalender yang sama.
  await sql`UPDATE ga_asset_assignments SET returned_date = ${returnedDate}, returned_at = now(), notes = COALESCE(${input.notes ?? null}, notes) WHERE id = ${active[0].id}`;

  // Recompute cache ga_assets: kalau masih ada assignment aktif lain (kategori shared), pakai yg paling baru; kalau tak ada, kosongkan.
  const remaining = await sql`
    SELECT user_id FROM ga_asset_assignments WHERE asset_id = ${assetId} AND returned_date IS NULL
    ORDER BY assigned_date DESC, created_at DESC LIMIT 1
  `;
  if (remaining.length > 0) {
    await sql`UPDATE ga_assets SET current_pic_user_id = ${remaining[0].user_id}, pic_name_override = NULL, updated_at = now() WHERE id = ${assetId}`;
  } else {
    await sql`UPDATE ga_assets SET current_pic_user_id = NULL, pic_name_override = NULL, updated_at = now() WHERE id = ${assetId}`;
  }
  await logAudit("ga_asset.return", { asset_id: assetId, assignment_id: active[0].id, returned_date: returnedDate });
  return { ok: true };
}

// ───────────────────────── Transfer ─────────────────────────

export interface TransferInput {
  to_user_id?: string | null;
  to_pic_name?: string | null;
  to_location?: string | null;
  reason?: string | null;
  created_by?: string | null;
  transfer_date?: string | null;
}

export async function transferAsset(assetId: string, input: TransferInput): Promise<GaAssetRow | ActionResult> {
  const sql = db();
  const rows = await sql`SELECT id, asset_code, nama, current_pic_user_id, location FROM ga_assets WHERE id = ${assetId}`;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  const asset = rows[0];

  let toUserId = input.to_user_id ?? null;
  const toPicNameTrim = input.to_pic_name?.trim() || null;
  if (!toUserId && toPicNameTrim) toUserId = await resolveUserByName(toPicNameTrim);
  if (!toUserId) {
    return {
      ok: false,
      error: "to_user_id wajib (atau to_pic_name yang cocok nama user terdaftar) — utk PIC belum terdaftar, pakai edit \"PIC (override cepat)\" di form Aset",
    };
  }

  await sql`
    INSERT INTO ga_asset_transfers (asset_id, from_user_id, to_user_id, from_location, to_location, transfer_date, reason, created_by)
    VALUES (${assetId}, ${asset.current_pic_user_id}, ${toUserId}, ${asset.location}, ${input.to_location ?? asset.location}, ${input.transfer_date ?? wibToday()}, ${input.reason ?? null}, ${input.created_by ?? null})
  `;
  await sql`
    UPDATE ga_assets SET
      current_pic_user_id = ${toUserId}, pic_name_override = NULL,
      location = COALESCE(${input.to_location ?? null}, location), updated_at = now()
    WHERE id = ${assetId}
  `;
  await notifyPic(toUserId, String(asset.asset_code), String(asset.nama), "transfer").catch(() => {});

  let humanActor: string | null = null;
  if (input.created_by) {
    const [u] = await sql`SELECT name FROM app_user WHERE id = ${input.created_by}`;
    humanActor = u?.name ? String(u.name) : null;
  }
  await logAudit("ga_asset.transfer", {
    asset_id: assetId, asset_code: asset.asset_code,
    from_user_id: asset.current_pic_user_id, to_user_id: toUserId, reason: input.reason ?? null,
  }, humanActor);

  return (await getAsset(assetId))!;
}

// ───────────────────────── History timeline ─────────────────────────

export interface HistoryEntry {
  kind: "assign" | "return" | "transfer";
  date: string;
  user_name: string | null;
  detail: string | null;
}

// sortKey internal-only (timestamp asli event, BUKAN cuma tanggal kalender)
// — dibuang sebelum return, cuma dipakai buat urutkan.
type HistoryEntryInternal = HistoryEntry & { sortKey: string };

export async function getAssetHistory(assetId: string): Promise<HistoryEntry[]> {
  const sql = db();
  const assigns = await sql`
    SELECT a.assigned_date::text AS assigned_date, a.returned_date::text AS returned_date,
           a.returned_at::text AS returned_at,
           u.name AS user_name, a.department, a.created_at::text AS created_at
    FROM ga_asset_assignments a JOIN app_user u ON u.id = a.user_id
    WHERE a.asset_id = ${assetId}
    ORDER BY a.created_at DESC
  `;
  const transfers = await sql`
    SELECT t.transfer_date::text AS transfer_date, t.reason, t.from_location, t.to_location,
           u.name AS to_user_name, fu.name AS from_user_name, t.created_at::text AS created_at
    FROM ga_asset_transfers t
    JOIN app_user u ON u.id = t.to_user_id
    LEFT JOIN app_user fu ON fu.id = t.from_user_id
    WHERE t.asset_id = ${assetId}
    ORDER BY t.created_at DESC
  `;

  // Urutkan pakai timestamp ASLI (created_at/returned_at), bukan cuma tanggal
  // kalender — tanpa ini, assign+return+transfer yg jatuh di hari yang sama
  // (lumrah kalau staf GA proses beberapa mutasi aset sekaligus) ke-scramble:
  // stable sort cuma pertahankan urutan concat (semua assign/return dulu,
  // baru transfer), BUKAN urutan waktu sungguhan.
  const entries: HistoryEntryInternal[] = [];
  for (const a of assigns) {
    entries.push({
      kind: "assign", date: String(a.assigned_date), sortKey: String(a.created_at),
      user_name: a.user_name ? String(a.user_name) : null, detail: a.department ? String(a.department) : null,
    });
    if (a.returned_date) {
      entries.push({
        kind: "return", date: String(a.returned_date),
        // returned_at bisa NULL utk baris lama (sebelum kolom ini ada) —
        // fallback ke created_at (assign-nya) drpd kosong.
        sortKey: a.returned_at ? String(a.returned_at) : String(a.created_at),
        user_name: a.user_name ? String(a.user_name) : null, detail: null,
      });
    }
  }
  for (const t of transfers) {
    const detail = [t.from_user_name ? `dari ${t.from_user_name}` : null, t.reason ? String(t.reason) : null].filter(Boolean).join(" — ") || null;
    entries.push({
      kind: "transfer", date: String(t.transfer_date), sortKey: String(t.created_at),
      user_name: t.to_user_name ? String(t.to_user_name) : null, detail,
    });
  }
  entries.sort((x, y) => (x.sortKey < y.sortKey ? 1 : x.sortKey > y.sortKey ? -1 : 0));
  return entries.map((e) => ({ kind: e.kind, date: e.date, user_name: e.user_name, detail: e.detail }));
}
