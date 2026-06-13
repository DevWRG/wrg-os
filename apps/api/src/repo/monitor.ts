import { db } from "../db.js";
import { callAi, aiDryRun } from "../ai.js";

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
  kind: "rekap" | "resume" | "daily" | "weekly";
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

// ── Generate (pipeline AI, generate-only — TIDAK mengirim WA) ──
// Baca wa_message tanggal tsb → services/ai POST /rekap → simpan monitor_digest.
async function memberGroupMaps() {
  const sql = db();
  const mem = await sql`SELECT phone, COALESCE(panggilan, nama) AS nm FROM monitor_member WHERE COALESCE(panggilan, nama) IS NOT NULL`;
  const grp = await sql`SELECT group_jid, group_name FROM monitor_pola WHERE group_name IS NOT NULL`;
  const members: Record<string, string> = {};
  for (const m of mem) members[String(m.phone)] = String(m.nm);
  const groups: Record<string, string> = {};
  for (const g of grp) groups[String(g.group_jid)] = String(g.group_name);
  return { members, groups };
}

export async function generateRekap(date: string, jam: string) {
  const sql = db();
  const rows = await sql`
    SELECT group_jid, COALESCE(sender_name, sender_jid, '?') AS sender, body, message_type,
           (extract(epoch from received_at) * 1000)::bigint AS ts_ms
    FROM wa_message
    WHERE received_at::date = ${date} AND body IS NOT NULL AND body <> ''
    ORDER BY received_at
  `;
  if (rows.length === 0) return { stored: false, jumlah_pesan: 0, dry_run: false, error: "tak ada pesan WA untuk tanggal ini" };
  const messages = rows.map((r) => ({
    jid: String(r.group_jid),
    ts_ms: Number(r.ts_ms),
    sender: String(r.sender),
    body: String(r.body),
    media: r.message_type && r.message_type !== "text" ? String(r.message_type) : null,
  }));
  const { members, groups } = await memberGroupMaps();
  const { status, data } = await callAi("/rekap", { jam, tanggal: date, window_label: "hari ini", messages, members, groups, dry_run: aiDryRun() });
  if (status !== 200) return { stored: false, jumlah_pesan: messages.length, dry_run: false, error: `services/ai ${status}` };
  const rekap = String(data.rekap ?? "");
  if (rekap) await upsertDigests([{ kind: "rekap", tanggal: date, waktu: jam, content: rekap, source_file: "generated" }]);
  return { stored: !!rekap, jumlah_pesan: messages.length, dry_run: Boolean(data.dry_run), model: data.model ? String(data.model) : null };
}

export async function generateResume(date: string, jam: string) {
  const sql = db();
  const rekaps = await sql`SELECT waktu, content FROM monitor_digest WHERE kind = 'rekap' AND tanggal = ${date} ORDER BY waktu`;
  if (rekaps.length === 0) return { stored: false, jumlah_rekap: 0, dry_run: false, error: "tak ada rekap untuk tanggal ini (generate rekap dulu)" };
  const { members, groups } = await memberGroupMaps();
  const { status, data } = await callAi("/resume", {
    jam,
    tanggal: date,
    rekaps: rekaps.map((r) => ({ label: `${date} ${r.waktu ?? ""}`.trim(), text: String(r.content) })),
    members,
    groups,
    dry_run: aiDryRun(),
  });
  if (status !== 200) return { stored: false, jumlah_rekap: rekaps.length, dry_run: false, error: `services/ai ${status}` };
  const resume = String(data.resume ?? "");
  if (resume) await upsertDigests([{ kind: "resume", tanggal: date, waktu: jam, content: resume, source_file: "generated" }]);
  return { stored: !!resume, jumlah_rekap: rekaps.length, dry_run: Boolean(data.dry_run), model: data.model ? String(data.model) : null };
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
