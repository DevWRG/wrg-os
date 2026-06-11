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
