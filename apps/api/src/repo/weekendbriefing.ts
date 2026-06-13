import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { memberGroupMaps, upsertDigests } from "./monitor.js";

// briefing_weekend — port wrg-monitor/scripts/briefing_weekend.sh.
// Gabung resume harian 7 hari terakhir (monitor_digest kind='resume') + direktori
// member/grup + profil pola → services/ai /weekend-briefing (LLM) → briefing
// direktur (format A–H). GENERATE-ONLY (tanpa kirim WA) — simpan kind='briefing'.

const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const tglID = (d: Date): string => `${d.getUTCDate()} ${BULAN_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export interface WeekendBriefingResult {
  stored: boolean; jumlah_resume: number; dry_run: boolean; model?: string | null; error?: string;
}

export async function runWeekendBriefing(
  opts: { dryRun?: boolean } = {},
): Promise<WeekendBriefingResult> {
  const sql = db();
  const now = wibNow();
  const todayStr = now.toISOString().slice(0, 10);
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - 6);
  const mingguLabel = `Briefing Mingguan: ${tglID(weekStart)} – ${tglID(now)}`;

  // Resume harian 7 hari terakhir (1 baris per tanggal+waktu).
  const resumes = await sql`
    SELECT tanggal::text AS tanggal, waktu, content
    FROM monitor_digest
    WHERE kind = 'resume' AND tanggal >= CURRENT_DATE - 6
    ORDER BY tanggal, waktu
  `;
  if (resumes.length === 0) {
    return { stored: false, jumlah_resume: 0, dry_run: false, error: "tak ada resume 7 hari terakhir" };
  }

  const { members, groups } = await memberGroupMaps();
  const pola = await sql`
    SELECT group_jid, content FROM monitor_pola WHERE content IS NOT NULL AND content <> ''
  `;

  const { status, data } = await callAi("/weekend-briefing", {
    tanggal: todayStr,
    minggu_label: mingguLabel,
    resumes: resumes.map((r) => ({ label: `${r.tanggal} ${r.waktu ?? ""}`.trim(), text: String(r.content) })),
    members,
    groups,
    pola: pola.map((p) => ({ jid: String(p.group_jid), content: String(p.content) })),
    dry_run: aiDryRun(),
  });
  if (status !== 200) return { stored: false, jumlah_resume: resumes.length, dry_run: false, error: `services/ai ${status}` };

  let briefing = String(data.briefing ?? "");
  if (briefing.length < 50) return { stored: false, jumlah_resume: resumes.length, dry_run: Boolean(data.dry_run), error: "AI returned empty/short" };

  // Layer-2 anti-halusinasi (port pelajaran legacy): "Minggu" ambigu di B.Indonesia
  // (Week vs Sunday) → AI suka ngarang range tanggal. Paksa label periode kanonik:
  // (a) baris **Briefing Mingguan: ...**, (b) defensive "Minggu N[, ]Bulan YYYY" di mana pun.
  briefing = briefing.replace(/\*\*Briefing Mingguan:[^\n*]*\*\*/g, `**${mingguLabel}**`);
  briefing = briefing.replace(
    /Minggu \d+(?:[–-]\d+)?,?\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g,
    mingguLabel,
  );

  if (!opts.dryRun) {
    const jam = now.toISOString().slice(11, 16);
    await upsertDigests([{ kind: "briefing", tanggal: todayStr, waktu: jam, content: briefing, source_file: "generated" }]);
  }
  return { stored: !opts.dryRun, jumlah_resume: resumes.length, dry_run: Boolean(data.dry_run), model: data.model ? String(data.model) : null };
}
