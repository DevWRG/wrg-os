import { db } from "../db.js";

// WRG Monitor — direktori member WA (gabungan roster + members.json), di-key HP.

export interface MonitorMember {
  phone: string;
  nama: string | null;
  panggilan: string | null;
  posisi: string | null;
  cabang: string | null;
  wa_name: string | null;
  group_count: number;
  in_roster: boolean;
}

export interface MonitorMemberInput {
  phone: string;
  nama?: string | null;
  panggilan?: string | null;
  posisi?: string | null;
  cabang?: string | null;
  wa_name?: string | null;
  group_count?: number;
  in_roster?: boolean;
}

export async function upsertMembers(rows: MonitorMemberInput[]): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (!r.phone) continue;
    await sql`
      INSERT INTO monitor_member (phone, nama, panggilan, posisi, cabang, wa_name, group_count, in_roster, updated_at)
      VALUES (${r.phone}, ${r.nama ?? null}, ${r.panggilan ?? null}, ${r.posisi ?? null},
              ${r.cabang ?? null}, ${r.wa_name ?? null}, ${r.group_count ?? 0}, ${r.in_roster ?? false}, NOW())
      ON CONFLICT (phone) DO UPDATE SET
        nama = EXCLUDED.nama, panggilan = EXCLUDED.panggilan, posisi = EXCLUDED.posisi,
        cabang = EXCLUDED.cabang, wa_name = EXCLUDED.wa_name, group_count = EXCLUDED.group_count,
        in_roster = EXCLUDED.in_roster, updated_at = NOW()
    `;
    n++;
  }
  return n;
}

// ── Digest (rekap / resume) ──
export interface DigestInput {
  kind: "rekap" | "resume";
  tanggal: string;
  waktu?: string | null;
  content: string;
  source_file?: string | null;
}
export interface DigestEntry {
  waktu: string | null;
  content: string;
}

export async function upsertDigests(rows: DigestInput[]): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (!r.kind || !r.tanggal || !r.content) continue;
    await sql`
      INSERT INTO monitor_digest (kind, tanggal, waktu, content, source_file)
      VALUES (${r.kind}, ${r.tanggal}, ${r.waktu ?? null}, ${r.content}, ${r.source_file ?? null})
      ON CONFLICT (kind, tanggal, waktu) DO UPDATE SET
        content = EXCLUDED.content, source_file = EXCLUDED.source_file, created_at = NOW()
    `;
    n++;
  }
  return n;
}

// Daftar tanggal yang punya digest + entri untuk satu tanggal (default terbaru).
export async function listDigest(kind: "rekap" | "resume", date?: string) {
  const sql = db();
  const dateRows = await sql`
    SELECT DISTINCT tanggal::text AS d FROM monitor_digest WHERE kind = ${kind} ORDER BY d DESC
  `;
  const dates = dateRows.map((r) => String(r.d));
  const target = date && dates.includes(date) ? date : (dates[0] ?? null);
  const entries: DigestEntry[] = target
    ? (
        await sql`
          SELECT waktu, content FROM monitor_digest
          WHERE kind = ${kind} AND tanggal = ${target} ORDER BY waktu DESC NULLS LAST
        `
      ).map((e) => ({ waktu: e.waktu ? String(e.waktu) : null, content: String(e.content) }))
    : [];
  return { dates, date: target, entries };
}

// ── Pola (profil komunikasi grup) ──
export interface PolaInput {
  group_jid: string;
  group_name?: string | null;
  content: string;
}
export async function upsertPola(rows: PolaInput[]): Promise<number> {
  const sql = db();
  let n = 0;
  for (const r of rows) {
    if (!r.group_jid || !r.content) continue;
    await sql`
      INSERT INTO monitor_pola (group_jid, group_name, content, updated_at)
      VALUES (${r.group_jid}, ${r.group_name ?? null}, ${r.content}, NOW())
      ON CONFLICT (group_jid) DO UPDATE SET
        group_name = EXCLUDED.group_name, content = EXCLUDED.content, updated_at = NOW()
    `;
    n++;
  }
  return n;
}

// Daftar grup + profil satu grup (default grup pertama).
export async function listPola(jid?: string) {
  const sql = db();
  const groupRows = await sql`
    SELECT group_jid, COALESCE(group_name, group_jid) AS group_name FROM monitor_pola
    ORDER BY group_name
  `;
  const groups = groupRows.map((g) => ({ group_jid: String(g.group_jid), group_name: String(g.group_name) }));
  const target = jid && groups.some((g) => g.group_jid === jid) ? jid : (groups[0]?.group_jid ?? null);
  let content: string | null = null;
  let group_name: string | null = null;
  if (target) {
    const [row] = await sql`SELECT group_name, content FROM monitor_pola WHERE group_jid = ${target}`;
    content = row ? String(row.content) : null;
    group_name = row?.group_name ? String(row.group_name) : target;
  }
  return { groups, group_jid: target, group_name, content };
}

export async function listMembers(): Promise<MonitorMember[]> {
  const sql = db();
  const rows = await sql`
    SELECT phone, nama, panggilan, posisi, cabang, wa_name, group_count, in_roster
    FROM monitor_member
    ORDER BY in_roster DESC, cabang NULLS LAST, nama NULLS LAST, phone
  `;
  return rows.map((r) => ({
    phone: String(r.phone),
    nama: r.nama ? String(r.nama) : null,
    panggilan: r.panggilan ? String(r.panggilan) : null,
    posisi: r.posisi ? String(r.posisi) : null,
    cabang: r.cabang ? String(r.cabang) : null,
    wa_name: r.wa_name ? String(r.wa_name) : null,
    group_count: Number(r.group_count),
    in_roster: Boolean(r.in_roster),
  }));
}
