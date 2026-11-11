// Daily Summary versi ringkas (308) — keputusan product owner 11 Nov 2026: grup HOD Squad hanya menerima angka,
// nama yang belum report/plan, satu highlight, dan TAUTAN ke halaman detail publik /ds/<token> (tanpa login).
// Fungsi di sini murni (diuji tanpa DB) kecuali simpanTautan / bacaTautan.
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { matchedPct, type DaftarNama, type StatsDaily } from "./dailysummary.js";

/** Masa berlaku tautan /ds/<token>. */
export const DS_BERLAKU_HARI = 30;
export const TOKEN_DS = /^[A-Za-z0-9_-]{22}$/;

/** Token acak 128-bit, base64url → 22 huruf. */
export function buatTokenDs(): string {
  return randomBytes(16).toString("base64url");
}

export function tautanDs(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/ds/${token}`;
}

/** Judul section ringkasan LLM: "*Highlight*" atau "_Per Area_" (WhatsApp tebal/miring). */
const JUDUL = /^\s*[*_]([^*_]+)[*_]\s*$/;
const POIN = /^\s*[•\-*]\s+(.+)$/;

export interface OrangDs { nama: string; isi: string }
export interface AreaDs { area: string; orang: OrangDs[] }
export interface RingkasanDs { areas: AreaDs[]; highlight: string[] }

/**
 * Urai ringkasan LLM (sesudah paksaOverview/paksaDaftar) menjadi area → orang, plus poin Highlight. Format yang
 * diminta prompt: section "Per Area", tiap area satu judul miring/tebal, tiap orang "• Nama — ringkasan". Baris yang
 * tak cocok pola (lanjutan, poin tanpa "—") ditempel ke orang/area terakhir supaya tak ada isi yang hilang.
 */
export function uraiRingkasan(content: string): RingkasanDs {
  const areas: AreaDs[] = [];
  const highlight: string[] = [];
  let section = "";
  let area: AreaDs | null = null;
  for (const raw of content.split("\n")) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    const j = JUDUL.exec(l);
    if (j) {
      const t = j[1].trim();
      if (/^(overview|per area|highlight|perhatian|ijin|izin)$/i.test(t) || /daily summary/i.test(t)) {
        section = t.toLowerCase();
        area = null;
      } else if (section === "per area") {
        area = { area: t, orang: [] };
        areas.push(area);
      }
      continue;
    }
    if (section === "per area") {
      const p = POIN.exec(l);
      const isi = (p ? p[1] : l).trim();
      const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(isi);
      if (!area) { area = { area: "Lainnya", orang: [] }; areas.push(area); }
      if (p && m) area.orang.push({ nama: m[1].trim(), isi: m[2].trim() });
      else if (area.orang.length) area.orang[area.orang.length - 1].isi += ` ${isi}`;
      else area.orang.push({ nama: isi, isi: "" });
    } else if (section === "highlight") {
      const p = POIN.exec(l);
      highlight.push((p ? p[1] : l).trim());
    }
  }
  return { areas: areas.filter((a) => a.orang.length), highlight };
}

export interface WaRingkasInput {
  hari: string;
  tanggal: string;
  stats: StatsDaily;
  /** Nama pendek (panggilan) untuk WA; daftar lengkap ada di halaman. */
  pendek: DaftarNama;
  highlight: string | null;
  link: string;
}

const potong = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Maks nama per daftar di WA — daftar lengkap ada di halaman /ds/ (hari libur/gangguan bisa puluhan nama). */
export const MAKS_NAMA_WA = 15;
export function ringkasNama(nama: string[], maks = MAKS_NAMA_WA): string {
  return nama.length <= maks ? nama.join(", ") : `${nama.slice(0, maks).join(", ")} +${nama.length - maks} lainnya`;
}

/** Pesan WA ringkas untuk grup HOD Squad. Tanpa kurung sudut (WhatsApp membuang "<...>"). */
export function formatWaRingkas(x: WaRingkasInput): string {
  const s = x.stats;
  const out: string[] = [`📊 *Daily Summary — ${x.hari}, ${x.tanggal}*`, ""];
  out.push(`✅ ${s.anggota_aktif}/${s.wajib_total} tim lapor · ${s.total_report} laporan`);
  if (s.total_report > 0) out.push(`🎯 ${matchedPct(s)}% sesuai plan · ${s.unmatched} di luar plan`);
  out.push("");
  const { non_reporters: nr, no_plan: np, on_leave: cuti } = x.pendek;
  if (nr.length) out.push(`⚠️ *Belum report (${nr.length})*`, ringkasNama(nr));
  if (np.length) out.push(`📝 *Belum plan (${np.length})*`, ringkasNama(np));
  if (!nr.length && !np.length) out.push("👍 Semua yang wajib sudah plan & report.");
  if (cuti.length) out.push(`🌴 Ijin (${cuti.length}): ${ringkasNama(cuti)}`);
  if (x.highlight) out.push("", `💡 ${potong(x.highlight, 160)}`);
  out.push("", "🔗 Detail per area & per orang:", x.link);
  return out.join("\n");
}

export interface SimpanDs {
  tanggal: string; // YYYY-MM-DD (WIB)
  hari: string;
  label: string;
  stats: StatsDaily;
  daftar: DaftarNama;
  content: string;
}

/** Simpan/perbarui ringkasan tanggal itu; token lama dipertahankan (tautan yang sudah terkirim tetap berlaku). */
export async function simpanTautan(x: SimpanDs): Promise<string> {
  const sql = db();
  const stats = { ...x.stats, matched_pct: matchedPct(x.stats) };
  const [r] = await sql`
    INSERT INTO daily_summary_link (tanggal, token, hari, label, stats, daftar, content)
    VALUES (${x.tanggal}, ${buatTokenDs()}, ${x.hari}, ${x.label}, ${sql.json(stats as never)}, ${sql.json(x.daftar as never)}, ${x.content})
    ON CONFLICT (tanggal) DO UPDATE SET hari = EXCLUDED.hari, label = EXCLUDED.label, stats = EXCLUDED.stats,
      daftar = EXCLUDED.daftar, content = EXCLUDED.content, diubah_at = now()
    RETURNING token`;
  return String(r.token);
}

export interface DsPublik extends RingkasanDs {
  tanggal: string;
  hari: string;
  label: string;
  stats: StatsDaily & { matched_pct: number };
  daftar: DaftarNama;
  diubah_at: string;
}

/** Data halaman /ds/<token>; null bila token tak sah, tak ada, atau lewat masa berlaku. */
export async function bacaTautan(token: string): Promise<DsPublik | null> {
  if (!TOKEN_DS.test(token)) return null;
  const sql = db();
  const [r] = await sql`
    SELECT tanggal::text AS tanggal, hari, label, stats, daftar, content, diubah_at::text AS diubah_at
      FROM daily_summary_link
     WHERE token = ${token} AND dibuat_at > now() - make_interval(days => ${DS_BERLAKU_HARI})`;
  if (!r) return null;
  const daftar = (r.daftar ?? {}) as Partial<DaftarNama>;
  return {
    tanggal: String(r.tanggal), hari: String(r.hari), label: String(r.label),
    stats: r.stats as DsPublik["stats"],
    daftar: { non_reporters: daftar.non_reporters ?? [], no_plan: daftar.no_plan ?? [], on_leave: daftar.on_leave ?? [] },
    diubah_at: String(r.diubah_at),
    ...uraiRingkasan(String(r.content ?? "")),
  };
}
