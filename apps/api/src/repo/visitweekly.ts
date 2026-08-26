import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { FULL_SCOPE } from "./access-scope.js";
import { visitTargets, type AmVisitProgress } from "./visit.js";

// F16 CRM Fase 1 — rekap kunjungan MINGGU LALU vs target, dikirim Senin pagi
// (sebelum batas submit weekly 12:00) ke grup HoD supaya Rocky/Yogi punya angka
// saat push tim. Beda dari hod-daily (kepatuhan plan/report harian): yang ini
// mengukur VOLUME kunjungan vs target 20/minggu + 6 prospek baru.
//
// Scope sengaja FULL: ini rekap untuk HoD/manajemen, dikirim ke satu grup —
// bukan view per-user, jadi tak ada identitas pemanggil yang bisa dipakai
// membatasi baris.

const bar = (pct: number, width = 10) => {
  const f = Math.min(width, Math.max(0, Math.round((pct / 100) * width)));
  return "▓".repeat(f) + "░".repeat(width - f);
};

const label = (a: AmVisitProgress) => a.nama ?? a.am_id;

export async function runVisitWeeklyRecap(to?: string): Promise<{
  iso_week: number;
  week_start: string;
  team: number;
  on_track: number;
  below: string[];
  message: string | null;
  gateway: WaSendResult | null;
  audit_id: string | null;
}> {
  const sql = db();
  // weekOffset -1 = minggu ISO yang baru saja selesai.
  const k = await visitTargets(FULL_SCOPE, -1);
  const team = k.per_am.length;
  if (team === 0) {
    return { iso_week: k.iso_week, week_start: k.week_start, team: 0, on_track: 0, below: [], message: null, gateway: null, audit_id: null };
  }

  const sorted = [...k.per_am].sort((a, b) => b.pct - a.pct || label(a).localeCompare(label(b)));
  const below = sorted.filter((a) => a.target > 0 && a.visits < a.target).map(label);

  const lines = [
    `📍 *Rekap kunjungan minggu ${k.iso_week}* (mulai ${k.week_start})`,
    `Target ${k.target_default} kunjungan/minggu · ${k.new_target_default} prospek baru`,
    `Tercapai: ${k.on_track}/${team} AM`,
    "",
  ];
  // Angka capaian = kunjungan yang DILAPORKAN. `geo` dibawa terpisah sebagai
  // indikator kepatuhan foto — sebelumnya capaian dihitung dari geotag, jadi AM
  // yang rajin melapor tanpa geotag tampil 0% dan itu tidak bisa dibedakan dari
  // AM yang benar-benar tidak melapor.
  for (const a of sorted) {
    const newFlag = a.new_prospects >= a.new_target ? "✅" : `⚠️ ${a.new_prospects}/${a.new_target}`;
    lines.push(
      `${bar(a.pct)} ${String(a.pct).padStart(3)}%  ${label(a)} — ${a.visits}/${a.target}` +
        ` · geo ${a.visits_geotag}/${a.visits} · prospek baru ${newFlag}` +
        (a.visits_unbound > 0 ? ` · tak terikat ${a.visits_unbound}` : ""),
    );
  }
  const totVisit = sorted.reduce((s, a) => s + a.visits, 0);
  const totGeo = sorted.reduce((s, a) => s + a.visits_geotag, 0);
  if (totVisit > 0) {
    lines.push("", `📷 Foto geotag: ${totGeo}/${totVisit} kunjungan (${Math.round((totGeo / totVisit) * 100)}%)`);
  }
  if (below.length > 0) lines.push("", `⚠️ *Di bawah target (${below.length}):* ${below.join(", ")}`);
  // Sebagian yang tampil di bawah target sebenarnya SUDAH melapor — laporannya
  // tercatat di activity_log tapi tak terikat rencana (tanggal laporan beda dari
  // tanggal rencana). Tanpa baris ini, rekap menyebut nama mereka seolah tak
  // bekerja. Siapa yang ditandai TIDAK diubah — itu keputusan kebijakan.
  const takTerikat = sorted.filter((a) => a.visits_unbound > 0);
  if (takTerikat.length > 0) {
    lines.push(
      "",
      `ℹ️ *Ada laporan tak terikat rencana:* ${takTerikat.map((a) => `${label(a)} (${a.visits_unbound})`).join(", ")}`,
      "_Kerjanya tercatat, tanggal laporan ≠ tanggal rencana — belum terhitung sebagai capaian._",
    );
  }
  lines.push("", "_Weekly submit paling lambat Senin 12:00._");
  const message = lines.join("\n");

  const target = to || process.env.VISIT_WEEKLY_WA_TARGET || process.env.HOD_WA_TARGET || process.env.REMINDER_WA_TARGET || "";
  const gateway = await sendViaWaGateway(target || "_hod_group", message);
  if (!gateway.sent) {
    return { iso_week: k.iso_week, week_start: k.week_start, team, on_track: k.on_track, below, message, gateway, audit_id: null };
  }

  const inputHash = createHash("sha256").update(`${k.week_start}:${team}`).digest("hex");
  const outputHash = createHash("sha256").update(message).digest("hex");
  const payload = { iso_year: k.iso_year, iso_week: k.iso_week, week_start: k.week_start, team, on_track: k.on_track, below };
  const [a] = await sql`
    INSERT INTO audit_log
      (use_case_id, correlation_id, agent_id, layer, event_type, r_tier, input_hash, output_hash, payload)
    VALUES
      ('D1', ${`visitwk-${inputHash.slice(0, 8)}`}, NULL, 4, 'crm.recap.visit_weekly', 'R1',
       ${inputHash}, ${outputHash}, ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return { iso_week: k.iso_week, week_start: k.week_start, team, on_track: k.on_track, below, message, gateway, audit_id: a.id as string };
}
