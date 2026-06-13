import { db } from "../db.js";

// list_members (port wrg-monitor/scripts/list_members.sh) — versi PRAGMATIS wrg-os.
// Legacy scrape state internal openclaw (session group_members + LID mapping) untuk
// direktori member kaya. wa_message wrg-os tak menyimpan nomor pengirim individual
// (sender_jid = group_jid), jadi sumber nomor native = roster master_user.
// Sync roster master_user → monitor_member: enrich nama/panggilan/posisi/cabang +
// in_roster, buat entri phantom utk roster yg belum ada. PRESERVE wa_name &
// group_count (data hasil discovery, jangan ditimpa). Tanpa WA, tanpa LLM.

export interface RefreshMembersResult {
  roster_candidates: number; synced: number; dryRun?: boolean;
}

export async function runRefreshMembers(opts: { dryRun?: boolean } = {}): Promise<RefreshMembersResult> {
  const sql = db();
  const [c] = await sql`
    SELECT count(*)::int AS n FROM master_user
    WHERE wa_number IS NOT NULL AND regexp_replace(wa_number, '[^0-9]', '', 'g') <> ''
  `;
  const candidates = Number(c?.n ?? 0);
  if (opts.dryRun) return { roster_candidates: candidates, synced: 0, dryRun: true };

  // master_user.wa_number '62..' → monitor_member.phone '+62..'. ON CONFLICT hanya
  // update field roster (COALESCE jaga nilai lama bila roster kosong); wa_name &
  // group_count TIDAK disentuh agar hasil discovery tetap utuh.
  const res = await sql`
    INSERT INTO monitor_member (phone, nama, panggilan, posisi, cabang, in_roster, group_count, updated_at)
    SELECT '+' || regexp_replace(wa_number, '[^0-9]', '', 'g') AS phone,
           NULLIF(nama, ''), NULLIF(panggilan, ''), NULLIF(posisi, ''), NULLIF(cabang, ''),
           true, 0, now()
    FROM master_user
    WHERE wa_number IS NOT NULL AND regexp_replace(wa_number, '[^0-9]', '', 'g') <> ''
    ON CONFLICT (phone) DO UPDATE SET
      nama = COALESCE(EXCLUDED.nama, monitor_member.nama),
      panggilan = COALESCE(EXCLUDED.panggilan, monitor_member.panggilan),
      posisi = COALESCE(EXCLUDED.posisi, monitor_member.posisi),
      cabang = COALESCE(EXCLUDED.cabang, monitor_member.cabang),
      in_roster = true,
      updated_at = now()
  `;
  return { roster_candidates: candidates, synced: res.count ?? candidates };
}
