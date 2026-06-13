import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { upsertPola } from "./monitor.js";

// pola_komunikasi — port wrg-monitor/scripts/pola_komunikasi.sh.
// Untuk tiap grup aktif (>= MIN pesan dalam window), hitung statistik lokal +
// sample pesan → services/ai /pola-profile (LLM) → simpan markdown ke
// monitor_pola.content. GENERATE-ONLY (tanpa WA). Fingerprint: skip grup yg
// pola-nya masih segar (< 3 pesan baru sejak update terakhir).

const IGNORED = new Set(["120363409252019573@g.us"]); // grup Research/trial
const NEW_THRESHOLD = 3;

const wibTimestamp = (): string => {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.toISOString().slice(0, 10)}_${d.toISOString().slice(11, 16).replace(":", "")}`;
};

export interface PolaResult {
  total_groups: number; processed: number; skipped: number; ai_failures: number;
}

export async function runPolaKomunikasi(
  opts: { dryRun?: boolean; windowDays?: number; minMessages?: number } = {},
): Promise<PolaResult> {
  const sql = db();
  const w = opts.windowDays ?? 7;
  const minMsg = opts.minMessages ?? 5;
  const res: PolaResult = { total_groups: 0, processed: 0, skipped: 0, ai_failures: 0 };

  // Grup aktif dalam window (>= minMsg), + nama & waktu update pola terakhir.
  const groups = await sql`
    SELECT m.group_jid,
           COALESCE(max(m.group_name), mp.group_name) AS group_name,
           count(*)::int AS cnt,
           mp.updated_at AS pola_updated,
           count(*) FILTER (WHERE mp.updated_at IS NOT NULL AND m.received_at > mp.updated_at)::int AS new_since
    FROM wa_message m
    LEFT JOIN monitor_pola mp ON mp.group_jid = m.group_jid
    WHERE m.group_jid LIKE '%@g.us' AND m.received_at >= now() - (${w} || ' days')::interval
    GROUP BY m.group_jid, mp.group_name, mp.updated_at
    HAVING count(*) >= ${minMsg}
    ORDER BY count(*) DESC
  `;
  res.total_groups = groups.length;

  for (const g of groups) {
    const jid = String(g.group_jid);
    if (IGNORED.has(jid)) { res.skipped += 1; continue; }
    // Fingerprint: pola sudah ada & pesan baru < threshold → skip.
    if (g.pola_updated && Number(g.new_since) < NEW_THRESHOLD) { res.skipped += 1; continue; }

    const groupName = g.group_name ? String(g.group_name) : "";
    const count = Number(g.cnt);

    // Statistik lokal (top senders, jam aktif WIB, distribusi tipe).
    const [stats] = await sql`
      WITH m AS (
        SELECT sender_name, sender_jid, message_type, received_at
        FROM wa_message WHERE group_jid = ${jid} AND received_at >= now() - (${w} || ' days')::interval
      )
      SELECT
        (SELECT count(*) FROM m)::int AS total,
        (SELECT json_agg(t) FROM (SELECT COALESCE(sender_name, sender_jid, '?') AS sender, count(*)::int AS count FROM m GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t) AS top_senders,
        (SELECT json_agg(t) FROM (SELECT to_char(received_at, 'HH24') AS hour, count(*)::int AS count FROM m GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t) AS active_hours,
        (SELECT json_agg(t) FROM (SELECT COALESCE(message_type, 'text') AS type, count(*)::int AS count FROM m GROUP BY 1 ORDER BY 2 DESC) t) AS media
    `;
    const statsJson = JSON.stringify({
      total: Number(stats?.total ?? count),
      days_window: w,
      top_senders: stats?.top_senders ?? [],
      active_hours: stats?.active_hours ?? [],
      media_breakdown: stats?.media ?? [],
    });

    // Sample 120 pesan terakhir, urut kronologis, body dipotong 200 char.
    const [sample] = await sql`
      SELECT string_agg(line, E'\n' ORDER BY rt) AS s FROM (
        SELECT received_at AS rt,
               '[' || to_char(received_at, 'MM-DD HH24:MI') || '] ' || COALESCE(sender_name, sender_jid, '?') || ': ' || left(COALESCE(body, ''), 200) AS line
        FROM wa_message
        WHERE group_jid = ${jid} AND received_at >= now() - (${w} || ' days')::interval AND body IS NOT NULL AND body <> ''
        ORDER BY received_at DESC LIMIT 120
      ) x
    `;

    const label = groupName ? `${groupName} (${jid})` : jid;
    const { status, data } = await callAi("/pola-profile", {
      group_label: label, group_name: groupName, window_days: w, count,
      stats_json: statsJson, sample: sample?.s ? String(sample.s) : "", timestamp: wibTimestamp(),
      dry_run: aiDryRun(),
    });
    if (status !== 200) { res.ai_failures += 1; continue; }
    const profile = String(data.profile ?? "");
    if (profile.length < 50) { res.ai_failures += 1; continue; }

    if (!opts.dryRun) {
      await upsertPola([{ group_jid: jid, group_name: groupName || null, content: profile }]);
    }
    res.processed += 1;
  }
  return res;
}
