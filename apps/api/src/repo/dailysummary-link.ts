// Daily Summary versi ringkas (308) — keputusan product owner 11 Nov 2026: grup HOD Squad hanya menerima angka,
// nama yang belum report/plan, satu highlight, dan TAUTAN ke halaman detail publik /ds/<token> (tanpa login).
// Fungsi di sini murni (diuji tanpa DB) kecuali simpanTautan / bacaTautan.
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { matchedPct, type DaftarNama, type StatsDaily } from "./dailysummary.js";
import { kelompokPerHod, type HodPeta, type ItemTua, type OrangPeta, type PerHod } from "./dailysummary-hod.js";
import { extractTua } from "./notiftua.js";

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
  /** 311: "⏳ TUA (resume 14:00): Rocky 2 · Yogi 0" — null bila tak ada resume hari itu. */
  tua?: string | null;
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
  if (x.tua) out.push(x.tua);
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
  /** 311: snapshot peta HOD + item TUA terpetakan + sumbernya ("resume 14:00"). */
  hod?: HodPeta[];
  tua?: ItemTua[];
  tua_sumber?: string | null;
}

/** Simpan/perbarui ringkasan tanggal itu; token lama dipertahankan (tautan yang sudah terkirim tetap berlaku). */
export async function simpanTautan(x: SimpanDs): Promise<string> {
  const sql = db();
  const stats = { ...x.stats, matched_pct: matchedPct(x.stats) };
  const [r] = await sql`
    INSERT INTO daily_summary_link (tanggal, token, hari, label, stats, daftar, content, hod, tua, tua_sumber)
    VALUES (${x.tanggal}, ${buatTokenDs()}, ${x.hari}, ${x.label}, ${sql.json(stats as never)}, ${sql.json(x.daftar as never)}, ${x.content},
            ${sql.json((x.hod ?? []) as never)}, ${sql.json((x.tua ?? []) as never)}, ${x.tua_sumber ?? null})
    ON CONFLICT (tanggal) DO UPDATE SET hari = EXCLUDED.hari, label = EXCLUDED.label, stats = EXCLUDED.stats,
      daftar = EXCLUDED.daftar, content = EXCLUDED.content, hod = EXCLUDED.hod, tua = EXCLUDED.tua,
      tua_sumber = EXCLUDED.tua_sumber, diubah_at = now()
    RETURNING token`;
  return String(r.token);
}

export interface DsPublik extends RingkasanDs, PerHod {
  tua_sumber: string | null;
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
    SELECT tanggal::text AS tanggal, hari, label, stats, daftar, content, diubah_at::text AS diubah_at, hod, tua, tua_sumber
      FROM daily_summary_link
     WHERE token = ${token} AND dibuat_at > now() - make_interval(days => ${DS_BERLAKU_HARI})`;
  if (!r) return null;
  const daftar = (r.daftar ?? {}) as Partial<DaftarNama>;
  const ringkasan = uraiRingkasan(String(r.content ?? ""));
  // baris sebelum 311 tak punya snapshot HOD → peta yang berlaku sekarang
  let hod = (Array.isArray(r.hod) ? r.hod : []) as HodPeta[];
  if (!hod.length) { try { hod = await muatPetaHod(); } catch { hod = []; } }
  const tua = (Array.isArray(r.tua) ? r.tua : []) as ItemTua[];
  return {
    ...kelompokPerHod(ringkasan.areas, tua, hod),
    tua_sumber: r.tua_sumber ? String(r.tua_sumber) : null,
    tanggal: String(r.tanggal), hari: String(r.hari), label: String(r.label),
    stats: r.stats as DsPublik["stats"],
    daftar: { non_reporters: daftar.non_reporters ?? [], no_plan: daftar.no_plan ?? [], on_leave: daftar.on_leave ?? [] },
    diubah_at: String(r.diubah_at),
    ...ringkasan,
  };
}

/** 311: peta HOD → cabang (hod_territory, cabang huruf besar & unik) + nama panggilan dari master_hod. */
export async function muatPetaHod(): Promise<HodPeta[]> {
  const sql = db();
  const rows = await sql`
    SELECT h.hod_key, COALESCE(NULLIF(btrim(max(mh.panggilan)), ''), max(mh.nama), h.hod_key) AS nama,
           array_agg(DISTINCT upper(btrim(h.cabang)) ORDER BY upper(btrim(h.cabang))) AS cabang
      FROM hod_territory h LEFT JOIN master_hod mh ON mh.hod_key = h.hod_key
     GROUP BY h.hod_key ORDER BY min(mh.urutan) NULLS LAST, h.hod_key`;
  return rows.map((r) => ({ hod_key: String(r.hod_key), nama: String(r.nama), cabang: (r.cabang as string[]) ?? [] }));
}

/** 311: karyawan aktif (nama, panggilan, cabang) — pencocokan PIC item TUA ke cabang. */
export async function muatOrangPeta(): Promise<OrangPeta[]> {
  const rows = await db()`SELECT nama, panggilan, cabang FROM master_user WHERE aktif AND nama IS NOT NULL`;
  return rows.map((r) => ({ nama: String(r.nama), panggilan: r.panggilan ? String(r.panggilan) : null, cabang: r.cabang ? String(r.cabang) : null }));
}

/** 311: baris OUTSTANDING TUA dari resume grup WA terbaru tanggal itu; sumber null bila belum ada resume. */
export async function muatTuaHariIni(tanggal: string): Promise<{ sumber: string | null; baris: string[] }> {
  const [r] = await db()`SELECT waktu, content FROM monitor_digest WHERE kind = 'resume' AND tanggal = ${tanggal}
                          ORDER BY waktu DESC NULLS LAST LIMIT 1`;
  if (!r) return { sumber: null, baris: [] };
  return { sumber: `resume ${String(r.waktu ?? "").slice(0, 5)}`.trim(), baris: extractTua(String(r.content ?? "")) };
}
