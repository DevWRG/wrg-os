import { db } from "../db.js";
import { loadGroupSubjects } from "./group-names.js";

// Registri grup WA + kategorinya (principal / internal / customer). Daftar grup
// digabung dari DUA sumber supaya grup bertraffic rendah (mis. grup customer
// yang cuma 5 pesan) tetap terdaftar & bisa dikategorikan:
//   - monitor_pola  → grup yang sudah punya profil pola (>= 5 pesan/7 hari)
//   - wa_message    → semua grup '%@g.us' yang pernah bot ikuti
// Chat personal (JID tanpa @g.us) dikecualikan — bukan grup.

export const WA_GROUP_CATEGORIES = ["principal", "internal", "customer"] as const;
export type WaGroupCategory = (typeof WA_GROUP_CATEGORIES)[number];

export const isWaGroupCategory = (v: unknown): v is WaGroupCategory =>
  typeof v === "string" && (WA_GROUP_CATEGORIES as readonly string[]).includes(v);

export interface WaGroup {
  group_jid: string;
  group_name: string;
  category: WaGroupCategory | null;
  note: string | null;
  has_pola: boolean;
  message_count: number;
  last_message_at: string | null;
}

export async function listWaGroups(): Promise<WaGroup[]> {
  const sql = db();
  const rows = await sql`
    WITH jids AS (
      SELECT group_jid FROM monitor_pola WHERE group_jid LIKE '%@g.us'
      UNION
      SELECT DISTINCT group_jid FROM wa_message WHERE group_jid LIKE '%@g.us'
    ), msg AS (
      SELECT group_jid,
             count(*)::int AS message_count,
             max(received_at) AS last_message_at,
             max(NULLIF(group_name, '')) AS wa_name
      FROM wa_message WHERE group_jid LIKE '%@g.us'
      GROUP BY group_jid
    )
    SELECT j.group_jid,
           COALESCE(NULLIF(mp.group_name, ''), msg.wa_name, j.group_jid) AS group_name,
           c.category, c.note,
           (mp.group_jid IS NOT NULL) AS has_pola,
           COALESCE(msg.message_count, 0) AS message_count,
           msg.last_message_at
    FROM jids j
    LEFT JOIN monitor_pola mp ON mp.group_jid = j.group_jid
    LEFT JOIN wa_group_category c ON c.group_jid = j.group_jid
    LEFT JOIN msg ON msg.group_jid = j.group_jid
    ORDER BY 2
  `;
  // Nama: UTAMAKAN subject sessions.json openclaw (nama grup WA yang hidup).
  // monitor_pola.group_name bisa basi/keliru — mis. 6281335118687-1527497998
  // tersimpan "GROUP TRAINING KRM-TAGIH" padahal subject-nya "PENJUALAN
  // SOLO-JOGJA-PWT" (bikin dua kartu kembar di galeri). syncGroupNamesFromSessions
  // cuma mem-backfill nama yang KOSONG, jadi tak memperbaiki kasus ini.
  const subjects = loadGroupSubjects();
  return rows.map((r) => {
    const jid = String(r.group_jid);
    const name = String(r.group_name);
    return {
      group_jid: jid,
      group_name: subjects[jid] || (name === jid ? jid : name),
      category: isWaGroupCategory(r.category) ? r.category : null,
      note: r.note ? String(r.note) : null,
      has_pola: Boolean(r.has_pola),
      message_count: Number(r.message_count),
      last_message_at: r.last_message_at ? new Date(String(r.last_message_at)).toISOString() : null,
    };
  });
}

/** Set kategori dan/atau catatan satu grup.
 * - category: WaGroupCategory → set; null → kosongkan kategori.
 * - note: string → set; "" atau null → kosongkan; undefined → biarkan apa adanya.
 * Baris yang berakhir tanpa kategori DAN tanpa catatan dihapus (bukan disimpan
 * sebagai baris kosong), supaya tabel cuma memuat keputusan yang nyata. */
export async function setWaGroupCategory(
  group_jid: string,
  category: WaGroupCategory | null,
  note?: string | null,
): Promise<{ group_jid: string; category: WaGroupCategory | null; note: string | null }> {
  const sql = db();
  const keepNote = note === undefined;
  const nextNote = keepNote ? null : (note || "").trim() || null;
  if (!category) {
    // Tanpa kategori: baris cuma berguna kalau catatannya ada.
    const existing = keepNote
      ? ((await sql`SELECT note FROM wa_group_category WHERE group_jid = ${group_jid}`)[0]?.note ?? null)
      : nextNote;
    const finalNote = existing ? String(existing) : null;
    if (!finalNote) {
      await sql`DELETE FROM wa_group_category WHERE group_jid = ${group_jid}`;
      return { group_jid, category: null, note: null };
    }
    await sql`
      INSERT INTO wa_group_category (group_jid, category, note, updated_at)
      VALUES (${group_jid}, NULL, ${finalNote}, now())
      ON CONFLICT (group_jid) DO UPDATE SET category = NULL, note = ${finalNote}, updated_at = now()
    `;
    return { group_jid, category: null, note: finalNote };
  }
  const [row] = await sql`
    INSERT INTO wa_group_category (group_jid, category, note, updated_at)
    VALUES (${group_jid}, ${category}, ${nextNote}, now())
    ON CONFLICT (group_jid) DO UPDATE SET
      category = EXCLUDED.category,
      note = CASE WHEN ${keepNote} THEN wa_group_category.note ELSE ${nextNote} END,
      updated_at = now()
    RETURNING note
  `;
  return { group_jid, category, note: row?.note ? String(row.note) : null };
}
