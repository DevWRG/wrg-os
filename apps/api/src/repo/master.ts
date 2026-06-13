import { db } from "../db.js";

// D1 — master data CRM (port legacy master_user + master_territory). Roster AM
// di-key am_id (dipakai lintas deal/reminder/todo); territory map AM→HOD→cabang.

export interface MasterUserInput {
  am_id: string;
  nama: string;
  panggilan?: string;
  wa_number?: string;
  role?: string;
  posisi?: string;
  cabang?: string;
  area?: string;
  aktif?: boolean;
  wajib_plan_report?: boolean;
}

export async function upsertUser(u: MasterUserInput): Promise<{ am_id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO master_user
      (am_id, nama, panggilan, wa_number, role, posisi, cabang, area, aktif, wajib_plan_report)
    VALUES
      (${u.am_id}, ${u.nama}, ${u.panggilan ?? null}, ${u.wa_number ?? null},
       ${u.role ?? "AM"}, ${u.posisi ?? null}, ${u.cabang ?? null}, ${u.area ?? null},
       ${u.aktif ?? true}, ${u.wajib_plan_report ?? true})
    ON CONFLICT (am_id) DO UPDATE SET
      nama = EXCLUDED.nama, panggilan = EXCLUDED.panggilan, wa_number = EXCLUDED.wa_number,
      role = EXCLUDED.role, posisi = EXCLUDED.posisi, cabang = EXCLUDED.cabang,
      area = EXCLUDED.area, aktif = EXCLUDED.aktif, wajib_plan_report = EXCLUDED.wajib_plan_report
    RETURNING am_id
  `;
  return { am_id: String(rows[0].am_id) };
}

export interface MasterUserRow {
  am_id: string;
  nama: string;
  panggilan: string | null;
  wa_number: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  area: string | null;
  aktif: boolean;
  wajib_plan_report: boolean;
}

export async function listUsers(opts: { role?: string; aktif?: boolean } = {}): Promise<MasterUserRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT am_id, nama, panggilan, wa_number, role, posisi, cabang, area, aktif, wajib_plan_report
    FROM master_user
    WHERE ${opts.role ? sql`role = ${opts.role}` : sql`true`}
      AND ${opts.aktif === undefined ? sql`true` : sql`aktif = ${opts.aktif}`}
    ORDER BY cabang NULLS LAST, nama
  `;
  return rows.map((r) => ({
    am_id: String(r.am_id),
    nama: String(r.nama),
    panggilan: r.panggilan ? String(r.panggilan) : null,
    wa_number: r.wa_number ? String(r.wa_number) : null,
    role: String(r.role),
    posisi: r.posisi ? String(r.posisi) : null,
    cabang: r.cabang ? String(r.cabang) : null,
    area: r.area ? String(r.area) : null,
    aktif: Boolean(r.aktif),
    wajib_plan_report: Boolean(r.wajib_plan_report),
  }));
}

// Normalisasi nomor WA ke format 62xxxx (buang +, spasi, -, 0 awal → 62).
export function normalizeWa(raw: string): string {
  let n = String(raw).replace(/[^\d]/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (n.startsWith("620")) n = "62" + n.slice(3);
  return n;
}

// Resolve nomor WA pengirim → AM (master_user). Cocokkan setelah normalisasi
// kedua sisi. Hanya user aktif. null bila tak dikenal.
export async function resolveAmByWa(
  waNumber: string,
): Promise<{ am_id: string; nama: string; aktif: boolean } | null> {
  const sql = db();
  const norm = normalizeWa(waNumber);
  if (!norm) return null;
  const rows = await sql`
    SELECT am_id, nama, aktif FROM master_user
    WHERE regexp_replace(COALESCE(wa_number,''), '[^0-9]', '', 'g') = ${norm}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { am_id: String(rows[0].am_id), nama: String(rows[0].nama), aktif: Boolean(rows[0].aktif) };
}

export interface ResolvedAm {
  am_id: string;
  nama: string;
  aktif: boolean;
  via?: string;
  score?: number;
}

// Tier C — resolve via pushname (sender_name), 6 sub-strategi (port legacy
// resolve_user_by_pushname): exact nama/panggilan → nama-prefix → first-token
// → strip-separator → normalized-prefix kedua arah. Order by spesifisitas.
export async function resolveAmByPushname(pushname: string): Promise<ResolvedAm | null> {
  const name = String(pushname ?? "").trim();
  if (!name) return null;
  const sql = db();
  const rows = await sql`
    WITH p AS (SELECT regexp_replace(lower(${name}), '[^a-z]', '', 'g') AS norm)
    SELECT am_id, nama, aktif FROM master_user, p
    WHERE lower(nama) = lower(${name})
       OR lower(panggilan) = lower(${name})
       OR lower(nama) LIKE lower(${name}) || ' %'
       OR lower(panggilan) = lower(split_part(${name}, ' ', 1))
       OR lower(panggilan) = lower(regexp_replace(${name}, '[-_|/[:space:]].*$', ''))
       OR (length(p.norm) >= 5 AND regexp_replace(lower(nama), '[^a-z]', '', 'g') LIKE p.norm || '%')
       OR (length(p.norm) >= 5 AND p.norm LIKE regexp_replace(lower(nama), '[^a-z]', '', 'g') || '%')
    ORDER BY CASE
        WHEN lower(nama) = lower(${name}) THEN 1
        WHEN lower(panggilan) = lower(${name}) THEN 2
        WHEN lower(nama) LIKE lower(${name}) || ' %' THEN 3
        WHEN lower(panggilan) = lower(split_part(${name}, ' ', 1)) THEN 4
        WHEN lower(panggilan) = lower(regexp_replace(${name}, '[-_|/[:space:]].*$', '')) THEN 5
        ELSE 6
      END, length(nama)
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { am_id: String(rows[0].am_id), nama: String(rows[0].nama), aktif: Boolean(rows[0].aktif) };
}

// Stop-words token body (form-label, bukan nama orang) — port legacy.
const BODY_STOP = new Set([
  "cust", "hasil", "next", "tujuan", "goal", "tgl", "tanggal", "cabang",
  "rs", "rsu", "rsd", "rsud", "rsia", "rspau", "rsau", "rsab", "rsi", "rsgm",
  "klinik", "lab", "labkesda", "pkm", "puskesmas", "pmi", "dinkes", "dinas",
  "note", "visit", "jv", "join", "silaturahmi",
]);

function bodyTokens(name: string | null | undefined): string[] {
  const raw = String(name ?? "").match(/[A-Za-z]+/g) ?? [];
  return raw.filter((t) => !BODY_STOP.has(t.toLowerCase())).slice(0, 3);
}

// Tier A/D — skor kandidat body-name (nama setelah #plan/#report). Multi-token
// substring 100/95/…, panggilan exact 80, nama exact 70, nama-prefix 60,
// fuzzy panggilan 40. Tie-break nama terpendek. Port legacy BODY_BEST_ROW.
async function scoreBodyName(
  tokens: string[],
): Promise<{ am_id: string; nama: string; aktif: boolean; score: number; matched: string } | null> {
  if (tokens.length === 0) return null;
  const phrases: string[] = [];
  const scores: number[] = [];
  if (tokens.length >= 2) {
    let sc = 100;
    for (let n = tokens.length; n >= 2; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        phrases.push(tokens.slice(i, i + n).join(" "));
        scores.push(sc);
        sc -= 5;
      }
    }
  }
  const sql = db();
  const rows = await sql`
    WITH toks AS (SELECT tok, ord FROM unnest(${tokens}::text[]) WITH ORDINALITY AS t(tok, ord)),
    phr AS (
      SELECT phrase, sc FROM unnest(${phrases.length ? phrases : [""]}::text[], ${scores.length ? scores : [0]}::int[]) AS p(phrase, sc)
      WHERE phrase <> ''
    ),
    cand AS (
      SELECT m.am_id, m.nama, m.aktif, p.sc AS s, p.phrase AS matched
        FROM master_user m JOIN phr p ON position(lower(p.phrase) IN lower(m.nama)) > 0
      UNION ALL
      SELECT m.am_id, m.nama, m.aktif, 80 - (t.ord - 1) * 2, t.tok
        FROM master_user m JOIN toks t ON lower(m.panggilan) = lower(t.tok)
      UNION ALL
      SELECT m.am_id, m.nama, m.aktif, 70 - (t.ord - 1) * 2, t.tok
        FROM master_user m JOIN toks t ON lower(m.nama) = lower(t.tok)
      UNION ALL
      SELECT m.am_id, m.nama, m.aktif, 60 - (t.ord - 1) * 2, t.tok
        FROM master_user m JOIN toks t ON lower(m.nama) LIKE lower(t.tok) || ' %'
      UNION ALL
      SELECT m.am_id, m.nama, m.aktif, 40 - (t.ord - 1) * 2, t.tok
        FROM master_user m JOIN toks t
          ON m.panggilan IS NOT NULL AND abs(length(m.panggilan) - length(t.tok)) <= 2
         AND similarity(lower(m.panggilan), lower(t.tok)) >= 0.4
    )
    SELECT am_id, nama, aktif, s, matched FROM cand ORDER BY s DESC, length(nama) ASC LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    am_id: String(rows[0].am_id),
    nama: String(rows[0].nama),
    aktif: Boolean(rows[0].aktif),
    score: Number(rows[0].s),
    matched: String(rows[0].matched),
  };
}

function jidNumber(jid: string | null | undefined): string {
  if (!jid) return "";
  return String(jid).split("@")[0].split(":")[0];
}

// Resolver pengirim 5-tier (port legacy wrg-inbound.sh). Urutan:
//   A. body-name override (score ≥ 70) — `#plan <nama>` menang dulu (shared-HP)
//   B. sender phone (wa_number), hanya bila JID individu
//   C. sender pushname (6 sub-strategi)
//   D. body-name fuzzy (40 ≤ score < 70)
export async function resolveSender(opts: {
  bodyName?: string | null;
  senderJid?: string | null;
  pushname?: string | null;
}): Promise<ResolvedAm | null> {
  const tokens = bodyTokens(opts.bodyName);
  const bb = await scoreBodyName(tokens);

  // Tier A
  if (bb && bb.score >= 70) {
    return { am_id: bb.am_id, nama: bb.nama, aktif: bb.aktif, via: "body-name", score: bb.score };
  }
  // Tier B — sender phone (JID individu @s.whatsapp.net atau nomor ≤14 digit)
  const waNum = jidNumber(opts.senderJid);
  const norm = normalizeWa(waNum);
  const isIndividual = String(opts.senderJid ?? "").includes("@s.whatsapp.net") || (norm.length > 0 && norm.length <= 14);
  if (isIndividual && norm) {
    const b = await resolveAmByWa(norm);
    if (b) return { ...b, via: "phone" };
  }
  // Tier C — pushname
  const c = await resolveAmByPushname(opts.pushname ?? "");
  if (c) return { ...c, via: "pushname" };
  // Tier D — body fuzzy
  if (bb && bb.score >= 40) {
    return { am_id: bb.am_id, nama: bb.nama, aktif: bb.aktif, via: "body-fuzzy", score: bb.score };
  }
  return null;
}

export interface TerritoryInput {
  am_panggilan: string;
  hod_panggilan: string;
  cabang: string;
  kota: string;
}

export async function upsertTerritory(t: TerritoryInput): Promise<{ id: string }> {
  const sql = db();
  const rows = await sql`
    INSERT INTO master_territory (am_panggilan, hod_panggilan, cabang, kota)
    VALUES (${t.am_panggilan}, ${t.hod_panggilan}, ${t.cabang}, ${t.kota})
    ON CONFLICT (am_panggilan, cabang, kota) DO UPDATE SET
      hod_panggilan = EXCLUDED.hod_panggilan
    RETURNING id
  `;
  return { id: String(rows[0].id) };
}

export async function listTerritories(): Promise<
  { id: string; am_panggilan: string; hod_panggilan: string; cabang: string; kota: string }[]
> {
  const sql = db();
  const rows = await sql`
    SELECT id, am_panggilan, hod_panggilan, cabang, kota
    FROM master_territory ORDER BY cabang, am_panggilan
  `;
  return rows.map((r) => ({
    id: String(r.id),
    am_panggilan: String(r.am_panggilan),
    hod_panggilan: String(r.hod_panggilan),
    cabang: String(r.cabang),
    kota: String(r.kota),
  }));
}
