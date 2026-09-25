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
  /** "" untuk baris PRA-DAFTAR (awalan nama yang grupnya belum pernah kirim pesan). */
  group_jid: string;
  group_name: string;
  category: WaGroupCategory | null;
  /** manual = baris per-JID (keputusan admin); prefix = dari pra-daftar awalan nama. */
  category_source: "manual" | "prefix" | null;
  note: string | null;
  has_pola: boolean;
  message_count: number;
  last_message_at: string | null;
  /** true = grup belum pernah kirim pesan, jadi JID-nya belum diketahui. */
  pending: boolean;
  /** awalan pra-daftar yang dipakai (kunci tabel wa_group_category_prefix). */
  name_prefix: string | null;
}

export interface WaGroupPrefix {
  name_prefix: string;
  category: WaGroupCategory;
  note: string | null;
}

export async function listWaGroupPrefixes(): Promise<WaGroupPrefix[]> {
  const sql = db();
  const rows = await sql`SELECT name_prefix, category, note FROM wa_group_category_prefix ORDER BY name_prefix`;
  return rows
    .filter((r) => isWaGroupCategory(r.category))
    .map((r) => ({
      name_prefix: String(r.name_prefix),
      category: r.category as WaGroupCategory,
      note: r.note ? String(r.note) : null,
    }));
}

/**
 * Nama tampil untuk baris pra-daftar. Awalan yang disimpan admin cuma penggalan
 * ("Group PT Wahana X"), jadi kalau bot SUDAH join grupnya, subject openclaw
 * dipakai supaya kartunya bernama penuh seperti di WhatsApp. Cocok >1 = ambigu
 * (awalan sengaja pendek supaya menjaring beberapa grup) → tetap pakai awalan.
 */
export function namaPraDaftar(prefix: string, subjects: Record<string, string>): string {
  const p = prefix.toLowerCase();
  const hit = Object.values(subjects).filter((s) => s.toLowerCase().startsWith(p));
  return hit.length === 1 ? hit[0] : prefix;
}

/** Satu baris hasil query daftar grup — dipisah supaya perakitannya bisa diuji. */
export interface BarisGrupDb {
  group_jid: string;
  group_name: string;
  category: unknown;
  note: unknown;
  has_pola: boolean;
  message_count: number;
  last_message_at: string | null;
}

/**
 * Rakit baris DB + subject openclaw + pra-daftar awalan jadi daftar kartu.
 * Murni (tanpa DB) supaya aturan penamaan & prioritas kategorinya bisa diuji:
 * aturan itu tak pernah melempar error, salahnya cuma tampak sebagai kartu
 * bernama keliru atau kartu kembar.
 */
export function rakitDaftarGrup(
  rows: BarisGrupDb[],
  subjects: Record<string, string>,
  prefixList: WaGroupPrefix[],
): WaGroup[] {
  // Pra-daftar awalan nama diurut TERPANJANG dulu: 'Wahana - Snibe' harus menang
  // atas 'Wahana |'-style awalan pendek kalau keduanya cocok.
  const prefixes = [...prefixList].sort((a, b) => b.name_prefix.length - a.name_prefix.length);
  // Semua awalan yang cocok, terpanjang dulu. Yang terpanjang menentukan kategori;
  // sisanya tetap ditandai TERPAKAI supaya awalan pendek yang ternaungi ('Wahana '
  // di bawah 'Wahana - Snibe') tak memunculkan kartu pra-daftar hantu untuk grup
  // yang sebenarnya sudah ada di daftar.
  const matchPrefixes = (name: string) => {
    const n = name.toLowerCase();
    return prefixes.filter((p) => n.startsWith(p.name_prefix.toLowerCase()));
  };
  const usedPrefix = new Set<string>();

  const groups: WaGroup[] = rows.map((r) => {
    const jid = String(r.group_jid);
    const rawName = String(r.group_name);
    // Nama: UTAMAKAN subject openclaw (nama grup WA yang hidup).
    // monitor_pola.group_name bisa basi/keliru — mis. 6281335118687-1527497998
    // tersimpan "GROUP TRAINING KRM-TAGIH" padahal subject-nya "PENJUALAN
    // SOLO-JOGJA-PWT" (bikin dua kartu kembar di galeri). syncGroupNamesFromSessions
    // cuma mem-backfill nama yang KOSONG, jadi tak memperbaiki kasus ini.
    const name = subjects[jid] || (rawName === jid ? jid : rawName);
    const manual = isWaGroupCategory(r.category) ? r.category : null;
    const cocok = matchPrefixes(name);
    const hit = cocok[0] ?? null;
    for (const p of cocok) usedPrefix.add(p.name_prefix);
    return {
      group_jid: jid,
      group_name: name,
      // Baris per-JID (keputusan admin) SELALU menang atas pra-daftar.
      category: manual ?? hit?.category ?? null,
      category_source: manual ? "manual" : hit ? "prefix" : null,
      note: (r.note ? String(r.note) : null) ?? hit?.note ?? null,
      has_pola: Boolean(r.has_pola),
      message_count: Number(r.message_count),
      last_message_at: r.last_message_at ? new Date(String(r.last_message_at)).toISOString() : null,
      pending: false,
      name_prefix: hit?.name_prefix ?? null,
    };
  });

  // Awalan yang belum cocok ke grup mana pun → baris PRA-DAFTAR. Sejak JID dari
  // openclaw ikut terdaftar, sisanya tinggal awalan yang grupnya belum di-join
  // bot sama sekali — nama penuhnya memang belum ada di sumber mana pun.
  for (const p of prefixes) {
    if (usedPrefix.has(p.name_prefix)) continue;
    groups.push({
      group_jid: "",
      group_name: namaPraDaftar(p.name_prefix, subjects),
      category: p.category,
      category_source: "prefix",
      note: p.note,
      has_pola: false,
      message_count: 0,
      last_message_at: null,
      pending: true,
      name_prefix: p.name_prefix,
    });
  }
  return groups.sort((a, b) => a.group_name.localeCompare(b.group_name, "id"));
}

export async function listWaGroups(): Promise<WaGroup[]> {
  const sql = db();
  const subjects = loadGroupSubjects();
  const rows = await sql`
    WITH jids AS (
      SELECT group_jid FROM monitor_pola WHERE group_jid LIKE '%@g.us'
      UNION
      SELECT DISTINCT group_jid FROM wa_message WHERE group_jid LIKE '%@g.us'
      UNION
      -- Grup yang bot-nya SUDAH join tapi belum pernah kirim pesan: JID & namanya
      -- hanya ada di state openclaw. Tanpa baris ini kartunya tak pernah muncul,
      -- atau muncul sebagai pra-daftar bernama awalan ("Group PT Wahana X…").
      SELECT unnest(${Object.keys(subjects)}::text[])
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
  return rakitDaftarGrup(rows as unknown as BarisGrupDb[], subjects, await listWaGroupPrefixes());
}

/** Set/hapus pra-daftar kategori per awalan nama. category null → baris dihapus. */
export async function setWaGroupPrefixCategory(
  name_prefix: string,
  category: WaGroupCategory | null,
  note?: string | null,
): Promise<{ name_prefix: string; category: WaGroupCategory | null }> {
  const sql = db();
  if (!category) {
    await sql`DELETE FROM wa_group_category_prefix WHERE name_prefix = ${name_prefix}`;
    return { name_prefix, category: null };
  }
  const nextNote = note === undefined ? null : (note || "").trim() || null;
  const keepNote = note === undefined;
  await sql`
    INSERT INTO wa_group_category_prefix (name_prefix, category, note, updated_at)
    VALUES (${name_prefix}, ${category}, ${nextNote}, now())
    ON CONFLICT (name_prefix) DO UPDATE SET
      category = EXCLUDED.category,
      note = CASE WHEN ${keepNote} THEN wa_group_category_prefix.note ELSE ${nextNote} END,
      updated_at = now()
  `;
  return { name_prefix, category };
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
