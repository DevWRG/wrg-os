import { db } from "../db.js";
import { sendGaWa } from "../wasend.js";
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
    await sendGaWa(normalizeWa(t), msg);
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

// Samakan lokasi untuk perbandingan "berubah atau tidak": spasi & huruf besar
// tak dianggap pindah. Pure — diuji unit.
export const lokasiSama = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === (b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export async function transferAsset(
  assetId: string,
  input: TransferInput,
  opts: { dariRelokasi?: boolean } = {},
): Promise<GaAssetRow | ActionResult> {
  const sql = db();
  const rows = await sql`
    SELECT a.id, a.asset_code, a.nama, a.current_pic_user_id, a.location, a.pic_name_override, c.is_shared
    FROM ga_assets a JOIN ga_asset_categories c ON c.id = a.category_id
    WHERE a.id = ${assetId}
  `;
  if (rows.length === 0) return { ok: false, error: "aset tidak ditemukan" };
  const asset = rows[0];

  // Aset yang belum pernah di-assign siapa pun tak boleh ditransfer — tanpa
  // guard ini, transfer sukses set current_pic_user_id TAPI tak pernah
  // insert baris ga_asset_assignments, jadi PIC baru itu tak bisa di-return
  // maupun di-assign ulang lewat API manapun (dead-end permanen).
  const activeAssignments = await sql`SELECT id, user_id FROM ga_asset_assignments WHERE asset_id = ${assetId} AND returned_date IS NULL`;
  if (activeAssignments.length === 0 && !asset.current_pic_user_id && !asset.pic_name_override) {
    return { ok: false, error: "aset ini belum di-assign — assign dulu sebelum transfer" };
  }

  // Pindah LOKASI wajib lewat Relokasi + berita acara bertanda tangan
  // (keputusan user 13 Okt 2026). Transfer biasa = ganti PIC saja; tanpa
  // penjaga ini lokasi bisa berpindah tanpa berita acara lewat dialog Transfer.
  if (!opts.dariRelokasi && input.to_location?.trim() && !lokasiSama(input.to_location, asset.location as string | null)) {
    return { ok: false, error: "pindah lokasi wajib lewat Relokasi (dengan berita acara bertanda tangan) — Transfer hanya untuk ganti PIC" };
  }

  // Lokasi HANYA berubah lewat Relokasi; transfer biasa mengabaikan
  // to_location (yang "sama" pun tak ditulis ulang dengan ejaan lain).
  const toLocation = opts.dariRelokasi ? input.to_location ?? null : null;

  let toUserId = input.to_user_id ?? null;
  const toPicNameTrim = input.to_pic_name?.trim() || null;
  if (!toUserId && toPicNameTrim) toUserId = await resolveUserByName(toPicNameTrim);
  if (!toUserId && !toPicNameTrim) {
    return { ok: false, error: "to_user_id atau to_pic_name wajib diisi" };
  }

  const transferDate = input.transfer_date ?? wibToday();
  // Tutup assignment aktif PIC lama (kalau ada baris histori) supaya
  // return()/assign() berikutnya tetap konsisten — transfer = return dari
  // PIC lama + assign ke PIC baru, dicatat sbg satu event.
  for (const a of activeAssignments) {
    await sql`UPDATE ga_asset_assignments SET returned_date = ${transferDate}, returned_at = now() WHERE id = ${a.id}`;
  }

  if (!toUserId) {
    // PIC baru nama bebas, tak match user terdaftar manapun — sama pola
    // assignAsset(): TANPA baris histori assignment/transfer resmi
    // (ga_asset_assignments.user_id & ga_asset_transfers.to_user_id NOT
    // NULL, gak bisa dipaksa utk PIC tanpa akun), tapi assignment lama TETAP
    // ditutup di atas & tercatat ke audit_log. Sebelumnya transfer ke nama
    // bebas SELALU ditolak walau caption UI bilang bisa "isi nama bebas"
    // (ditemukan QA jalur tulis 2026-09-07, re-test pasca fitur Dito Anggara).
    await sql`
      UPDATE ga_assets SET
        current_pic_user_id = NULL, pic_name_override = ${toPicNameTrim},
        location = COALESCE(${toLocation}, location), updated_at = now()
      WHERE id = ${assetId}
    `;
    await logAudit("ga_asset.transfer_freetext", {
      asset_id: assetId, asset_code: asset.asset_code,
      from_user_id: asset.current_pic_user_id, to_pic_name: toPicNameTrim, reason: input.reason ?? null,
    });
    return (await getAsset(assetId))!;
  }

  await sql`
    INSERT INTO ga_asset_assignments (asset_id, user_id, assigned_date, notes, is_shared_snapshot)
    VALUES (${assetId}, ${toUserId}, ${transferDate}, ${input.reason ?? null}, ${Boolean(asset.is_shared)})
  `;

  await sql`
    INSERT INTO ga_asset_transfers (asset_id, from_user_id, to_user_id, from_location, to_location, transfer_date, reason, created_by)
    VALUES (${assetId}, ${asset.current_pic_user_id}, ${toUserId}, ${asset.location}, ${toLocation ?? asset.location}, ${transferDate}, ${input.reason ?? null}, ${input.created_by ?? null})
  `;
  await sql`
    UPDATE ga_assets SET
      current_pic_user_id = ${toUserId}, pic_name_override = NULL,
      location = COALESCE(${toLocation}, location), updated_at = now()
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

// ───────────────────────── Relokasi (pindah lokasi + berita acara) ─────────────────────────
// Keputusan user 13 Okt 2026: relokasi aset GA wajib berita acara bertanda
// tangan, disimpan SATU langkah bersama datanya; PIC boleh tetap. File sudah
// ditulis ke disk oleh pemanggil (index.ts) — kalau fungsi ini menolak,
// pemanggil yang menghapus file-nya.

export interface RelocateInput {
  to_location: string;
  keep_pic: boolean;
  to_user_id?: string | null;
  to_pic_name?: string | null;
  relocation_date?: string | null;
  reason?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  ba: { path: string; file_name: string | null; mime: string; size: number };
}

export interface RelocationRow {
  id: string;
  asset_id: string;
  asset_code: string;
  asset_nama: string;
  from_location: string | null;
  to_location: string;
  from_pic: string | null;
  to_pic: string | null;
  pic_berubah: boolean;
  relocation_date: string;
  reason: string | null;
  ba_path: string;
  ba_file_name: string | null;
  ba_mime: string | null;
  created_by_name: string | null;
  created_at: string;
}

export async function relocateAsset(assetId: string, input: RelocateInput): Promise<{ ok: true; relocation: RelocationRow } | ActionResult> {
  const sql = db();
  const before = await getAsset(assetId);
  if (!before) return { ok: false, error: "aset tidak ditemukan" };
  const toLocation = input.to_location?.trim().replace(/\s+/g, " ") ?? "";
  if (!toLocation) return { ok: false, error: "lokasi tujuan wajib diisi" };
  if (lokasiSama(toLocation, before.location)) {
    return { ok: false, error: `lokasi tujuan sama dengan lokasi sekarang (${before.location ?? "-"})` };
  }
  const relocationDate = input.relocation_date || wibToday();

  let toPic = before.pic_name;
  if (!input.keep_pic) {
    if (!input.to_user_id && !input.to_pic_name?.trim()) {
      return { ok: false, error: "pilih PIC baru, atau centang PIC tetap" };
    }
    // Aset belum punya PIC → PIC baru = assign (transfer menolak aset yang
    // belum di-assign). Lokasi diperbarui terpisah sesudahnya.
    const belumAdaPic = !before.current_pic_user_id && !before.pic_name;
    if (belumAdaPic) {
      const a = await assignAsset(assetId, {
        user_id: input.to_user_id ?? null,
        pic_name: input.to_pic_name ?? null,
        assigned_date: relocationDate,
        notes: input.reason ?? null,
      });
      if ("ok" in a && a.ok === false) return a;
      await sql`UPDATE ga_assets SET location = ${toLocation}, updated_at = now() WHERE id = ${assetId}`;
      toPic = (await getAsset(assetId))?.pic_name ?? null;
    }
    const r = belumAdaPic ? null : await transferAsset(
      assetId,
      {
        to_user_id: input.to_user_id ?? null,
        to_pic_name: input.to_pic_name ?? null,
        to_location: toLocation,
        reason: input.reason ?? null,
        created_by: input.created_by ?? null,
        transfer_date: relocationDate,
      },
      { dariRelokasi: true },
    );
    if (r && "ok" in r && r.ok === false) return r;
    if (r) toPic = (r as GaAssetRow).pic_name;
  } else {
    await sql`UPDATE ga_assets SET location = ${toLocation}, updated_at = now() WHERE id = ${assetId}`;
  }

  const [row] = await sql`
    INSERT INTO ga_asset_relocation (
      asset_id, from_location, to_location, from_pic, to_pic, pic_berubah, relocation_date, reason,
      ba_path, ba_file_name, ba_mime, ba_size, created_by, created_by_name
    ) VALUES (
      ${assetId}, ${before.location}, ${toLocation}, ${before.pic_name}, ${toPic}, ${!input.keep_pic},
      ${relocationDate}, ${input.reason?.trim() || null},
      ${input.ba.path}, ${input.ba.file_name}, ${input.ba.mime}, ${input.ba.size},
      ${input.created_by ?? null}, ${input.created_by_name ?? null}
    )
    RETURNING id
  `;
  await logAudit("ga_asset.relocate", {
    asset_id: assetId, asset_code: before.asset_code, from_location: before.location, to_location: toLocation,
    pic_berubah: !input.keep_pic, relocation_id: String(row.id),
  }, input.created_by_name ?? null);
  const [rel] = await listRelocations({ id: String(row.id) });
  return { ok: true, relocation: rel };
}

export async function listRelocations(opts: { id?: string; assetId?: string; from?: string; to?: string; limit?: number } = {}): Promise<RelocationRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT r.id, r.asset_id, a.asset_code, a.nama AS asset_nama, r.from_location, r.to_location,
           r.from_pic, r.to_pic, r.pic_berubah, r.relocation_date::text AS relocation_date, r.reason,
           r.ba_path, r.ba_file_name, r.ba_mime, r.created_by_name, r.created_at::text AS created_at
    FROM ga_asset_relocation r JOIN ga_assets a ON a.id = r.asset_id
    WHERE ${opts.id ? sql`r.id = ${opts.id}` : sql`true`}
      AND ${opts.assetId ? sql`r.asset_id = ${opts.assetId}` : sql`true`}
      AND ${opts.from ? sql`r.relocation_date >= ${opts.from}::date` : sql`true`}
      AND ${opts.to ? sql`r.relocation_date <= ${opts.to}::date` : sql`true`}
    ORDER BY r.relocation_date DESC, r.created_at DESC
    LIMIT ${opts.limit ?? 1000}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    asset_id: String(r.asset_id),
    asset_code: String(r.asset_code),
    asset_nama: String(r.asset_nama),
    from_location: r.from_location != null ? String(r.from_location) : null,
    to_location: String(r.to_location),
    from_pic: r.from_pic != null ? String(r.from_pic) : null,
    to_pic: r.to_pic != null ? String(r.to_pic) : null,
    pic_berubah: Boolean(r.pic_berubah),
    relocation_date: String(r.relocation_date),
    reason: r.reason != null ? String(r.reason) : null,
    ba_path: String(r.ba_path),
    ba_file_name: r.ba_file_name != null ? String(r.ba_file_name) : null,
    ba_mime: r.ba_mime != null ? String(r.ba_mime) : null,
    created_by_name: r.created_by_name != null ? String(r.created_by_name) : null,
    created_at: String(r.created_at),
  }));
}

// ───────────────────────── History timeline ─────────────────────────

export interface HistoryEntry {
  kind: "assign" | "return" | "transfer" | "relokasi";
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
  const relokasi = await sql`
    SELECT relocation_date::text AS relocation_date, from_location, to_location, to_pic, reason, created_at::text AS created_at
    FROM ga_asset_relocation WHERE asset_id = ${assetId}
  `;
  for (const r of relokasi) {
    const detail = [`${r.from_location ?? "-"} → ${r.to_location}`, r.reason ? String(r.reason) : null].filter(Boolean).join(" — ");
    entries.push({
      kind: "relokasi", date: String(r.relocation_date), sortKey: String(r.created_at),
      user_name: r.to_pic ? String(r.to_pic) : null, detail,
    });
  }
  entries.sort((x, y) => (x.sortKey < y.sortKey ? 1 : x.sortKey > y.sortKey ? -1 : 0));
  return entries.map((e) => ({ kind: e.kind, date: e.date, user_name: e.user_name, detail: e.detail }));
}
