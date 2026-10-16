// F85 — Senin Morning Brief Auto-Generator.
//
// Tiap Senin pagi (setelah watchpoint-snapshot 06:00) menilai KESIAPAN materi
// 8 HoD untuk rapat Direktur atas minggu ISO yang baru tutup, lalu kirim
// ringkasan WA ke Direktur. Format = "Direktur Overview Aggregation" di
// HOD-Prompt-Workflow.md §4 (Drive, 16 Jun 2026) — pengganti ~8 jam review
// manual Briefing_PraMeeting_CrossCheck_8HOD.
//
// Pembagian kerja yang DISENGAJA:
//   - Status per cek, status per HoD, dan Overall Health = DETERMINISTIK dari
//     data (fungsi murni di bawah, dites). LLM tak boleh memutuskan siapa
//     "TIDAK SIAP" — itu penilaian atas orang, harus bisa ditelusuri ke angka.
//   - LLM (services/ai /senin-brief) hanya menulis narasi: gap utama,
//     pertanyaan kritis, keputusan Direktur, urutan bahasan. Kalau LLM gagal,
//     brief TETAP tersimpan & terkirim tanpa narasi (narasi_ok=false).
//
// 5 cek (nomor ikut dokumen sumber):
//   1 Data terkini    — mirror Accurate segar (metric DB) + input manual minggu ini
//   2 Pipeline ber-Rp — deal terbuka punya nilai Rp + probabilitas + bulan beli
//   3 Tindak lanjut   — PROXY: kepatuhan #PLAN/#REPORT AM minggu itu. Belum ada
//                       tabel action item rapat; HoD tanpa AM → NA (fase 2).
//   4 KPI terlacak    — porsi metric WatchPoint yang punya nilai (bukan N/A)
//   5 Data basi       — deal >14 hari diam di stage / input manual terakhir lama
// NA = cek tak berlaku untuk HoD itu, TIDAK dihitung ke status.

import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { listHods } from "./master-hod.js";
import { mirrorFreshness } from "./mirror-health.js";
import { reportPerHod } from "./plandash.js";
import { listMetricDefs } from "./watchpoint.js";
import { fmtValue, getWeeklyBoard, snapshotWeek, type WeeklyHod } from "./watchpoint-weekly.js";
import { currentWeek, isoWeekOf, periodeLabel, previousWeek, weekRange } from "./watchpoint-week.js";

export type CekHasil = "OK" | "WARN" | "FAIL" | "NA";
export type HodStatus = "SIAP" | "PERLU KLARIFIKASI" | "TIDAK SIAP";
export type Health = "RED" | "RISK" | "ON-TRACK";

export interface Cek {
  no: 1 | 2 | 3 | 4 | 5;
  label: string;
  hasil: CekHasil;
  detail: string;
}

export interface HodBrief {
  hod_key: string;
  nama: string;
  peran: string;
  status: HodStatus;
  checks: Cek[];
  /** Status kinerja WatchPoint (konteks narasi; BUKAN penentu kesiapan). */
  watch_status: string;
}

export const LABEL_CEK: Record<Cek["no"], string> = {
  1: "Data terkini",
  2: "Pipeline ber-Rp",
  3: "Tindak lanjut",
  4: "KPI terlacak",
  5: "Data basi",
};

/** HoD yang materinya wajib memuat pipeline deal (Sales & Business). */
export const PIPELINE_HODS = new Set(["rocky", "yogi", "mufid", "arman"]);

const HARI_BASI_DEAL = 14;

// ── Fungsi murni: penilaian ──────────────────────────────────────

/** Ambang bertingkat: ≥ok → OK, ≥warn → WARN, sisanya FAIL. */
export function tingkat(pct: number, ok: number, warn: number): CekHasil {
  if (pct >= ok) return "OK";
  if (pct >= warn) return "WARN";
  return "FAIL";
}

/**
 * Status HoD dari cek yang berlaku (NA dibuang) — aturan dokumen sumber:
 * SIAP = semua hijau; TIDAK SIAP = ≥3 merah; sisanya PERLU KLARIFIKASI.
 * HoD tanpa satu pun cek yang berlaku = TIDAK SIAP (tak ada yang bisa diaudit).
 */
export function statusHod(checks: Pick<Cek, "hasil">[]): HodStatus {
  const berlaku = checks.filter((c) => c.hasil !== "NA");
  if (berlaku.length === 0) return "TIDAK SIAP";
  const fail = berlaku.filter((c) => c.hasil === "FAIL").length;
  if (fail >= 3) return "TIDAK SIAP";
  if (berlaku.every((c) => c.hasil === "OK")) return "SIAP";
  return "PERLU KLARIFIKASI";
}

/** RED = >2 HoD TIDAK SIAP; RISK = ada yang belum SIAP; ON-TRACK = semua SIAP. */
export function overallHealth(statuses: HodStatus[]): Health {
  const tidak = statuses.filter((s) => s === "TIDAK SIAP").length;
  if (tidak > 2) return "RED";
  if (statuses.some((s) => s !== "SIAP")) return "RISK";
  return "ON-TRACK";
}

export interface MirrorInfo { ok: boolean; terburukHari: number | null }

/**
 * Cek 1 — data terkini. Pembeda otomatis/manual diambil dari KATALOG metric
 * (`otomatis` = key yang punya rumus), bukan dari `source` nilainya: metric
 * otomatis yang belum tersnapshot juga bersumber "manual" di papan mingguan,
 * dan menyebutnya "belum diisi HoD" menyalahkan orang atas masalah sistem.
 */
export function cekDataTerkini(hod: WeeklyHod, mirror: MirrorInfo, otomatis: Set<string>): Cek {
  const auto = hod.metrics.filter((m) => otomatis.has(m.key));
  const manual = hod.metrics.filter((m) => !otomatis.has(m.key));
  const autoKosong = auto.filter((m) => m.status === "NA").length;
  const manualTerisi = manual.filter((m) => m.status !== "NA").length;
  const masalah: string[] = [];
  let hasil: CekHasil = "OK";
  const turun = (h: CekHasil) => { if (h === "FAIL" || hasil === "OK") hasil = h; };
  if (auto.length > 0 && !mirror.ok) {
    turun("FAIL");
    masalah.push(`data Accurate tertinggal ${mirror.terburukHari ?? "?"} hari`);
  }
  if (autoKosong > 0) {
    turun("WARN");
    masalah.push(`${autoKosong}/${auto.length} metric otomatis kosong (snapshot/sumber data)`);
  }
  if (manual.length > 0) {
    if (manualTerisi === 0) {
      turun("FAIL");
      masalah.push(`0/${manual.length} metric manual diisi HoD minggu ini`);
    } else if (manualTerisi < manual.length) {
      turun("WARN");
      masalah.push(`${manualTerisi}/${manual.length} metric manual diisi HoD`);
    }
  }
  return {
    no: 1, label: LABEL_CEK[1], hasil,
    detail: masalah.length ? masalah.join("; ") : [
      auto.length ? `${auto.length} metric otomatis tersnapshot, mirror Accurate segar` : null,
      manual.length ? `${manual.length} metric manual terisi` : null,
    ].filter(Boolean).join("; ") || "tak ada metric",
  };
}

export interface PipelineAgg { n: number; lengkap: number; basi: number; nilai: number; weighted: number }

/** Cek 2 — pipeline ber-Rp (nilai + probabilitas + bulan beli). */
export function cekPipeline(hodKey: string, p: PipelineAgg | undefined): Cek {
  if (!PIPELINE_HODS.has(hodKey)) return { no: 2, label: LABEL_CEK[2], hasil: "NA", detail: "bukan HoD pipeline" };
  if (!p || p.n === 0) return { no: 2, label: LABEL_CEK[2], hasil: "FAIL", detail: "0 deal terbuka tercatat di /pipeline" };
  const pct = Math.round((p.lengkap / p.n) * 100);
  return {
    no: 2, label: LABEL_CEK[2], hasil: tingkat(pct, 90, 60),
    detail: `${p.lengkap}/${p.n} deal lengkap (${pct}%) · nilai ${rp(p.nilai)} · weighted ${rp(p.weighted)}`,
  };
}

export interface KepatuhanAgg { jumlah_am: number; am_submit: number; plan_count: number; report_count: number; completion: number | null }

/** Cek 3 — tindak lanjut (proxy kepatuhan #PLAN/#REPORT AM). */
export function cekTindakLanjut(k: KepatuhanAgg | undefined): Cek {
  if (!k || k.jumlah_am === 0) {
    return { no: 3, label: LABEL_CEK[3], hasil: "NA", detail: "belum ada sumber action item (fase 2)" };
  }
  if (k.plan_count === 0 || k.completion === null) {
    return { no: 3, label: LABEL_CEK[3], hasil: "FAIL", detail: `0 plan dari ${k.jumlah_am} AM` };
  }
  return {
    no: 3, label: LABEL_CEK[3], hasil: tingkat(k.completion, 80, 50),
    detail: `report ${k.report_count}/${k.plan_count} plan (${k.completion}%) · ${k.am_submit}/${k.jumlah_am} AM submit plan`,
  };
}

/** Cek 4 — KPI terlacak (metric WatchPoint bernilai). */
export function cekKpi(hod: WeeklyHod): Cek {
  const total = hod.metrics.length;
  if (total === 0) return { no: 4, label: LABEL_CEK[4], hasil: "FAIL", detail: "belum ada metric WatchPoint" };
  const ada = hod.metrics.filter((m) => m.status !== "NA").length;
  const pct = Math.round((ada / total) * 100);
  const kosong = hod.metrics.filter((m) => m.status === "NA").map((m) => m.label);
  return {
    no: 4, label: LABEL_CEK[4], hasil: tingkat(pct, 100, 50),
    detail: `${ada}/${total} metric bernilai${kosong.length ? ` · N/A: ${kosong.join(", ")}` : ""}`,
  };
}

/** Cek 5 — data basi (deal macet di stage, atau input manual terakhir lama). */
export function cekBasi(
  hodKey: string, hod: WeeklyHod, p: PipelineAgg | undefined, manualTerakhirHari: number | null, otomatis: Set<string>,
): Cek {
  if (PIPELINE_HODS.has(hodKey) && p && p.n > 0) {
    const pct = Math.round((p.basi / p.n) * 100);
    return {
      no: 5, label: LABEL_CEK[5], hasil: tingkat(100 - pct, 70, 40),
      detail: `${p.basi}/${p.n} deal diam >${HARI_BASI_DEAL} hari di stage (${pct}%)`,
    };
  }
  const adaManual = hod.metrics.some((m) => !otomatis.has(m.key));
  // HoD pipeline tanpa deal: tak ada yang bisa dinilai basi (kekosongannya sudah
  // jadi merah di cek 2) — jangan dilaporkan "OK" seolah datanya segar.
  if (!adaManual && PIPELINE_HODS.has(hodKey)) {
    return { no: 5, label: LABEL_CEK[5], hasil: "NA", detail: "tak ada deal untuk dinilai (lihat cek 2)" };
  }
  if (!adaManual) return { no: 5, label: LABEL_CEK[5], hasil: "OK", detail: "semua metric dihitung otomatis dari DB" };
  if (manualTerakhirHari === null) return { no: 5, label: LABEL_CEK[5], hasil: "FAIL", detail: "metric manual belum pernah diisi" };
  const hasil: CekHasil = manualTerakhirHari <= 7 ? "OK" : manualTerakhirHari <= 28 ? "WARN" : "FAIL";
  return { no: 5, label: LABEL_CEK[5], hasil, detail: `input manual terakhir ${manualTerakhirHari} hari lalu` };
}

export function nilaiHod(
  hod: WeeklyHod,
  meta: { nama: string; peran: string },
  ctx: {
    mirror: MirrorInfo; pipeline?: PipelineAgg; kepatuhan?: KepatuhanAgg;
    manualTerakhirHari: number | null; otomatis: Set<string>;
  },
): HodBrief {
  const checks: Cek[] = [
    cekDataTerkini(hod, ctx.mirror, ctx.otomatis),
    cekPipeline(hod.key, ctx.pipeline),
    cekTindakLanjut(ctx.kepatuhan),
    cekKpi(hod),
    cekBasi(hod.key, hod, ctx.pipeline, ctx.manualTerakhirHari, ctx.otomatis),
  ];
  return {
    hod_key: hod.key, nama: meta.nama, peran: meta.peran,
    status: statusHod(checks), checks, watch_status: hod.status,
  };
}

// ── Fungsi murni: format ─────────────────────────────────────────

function rp(n: number): string {
  if (n >= 1e9) return `Rp ${(n / 1e9).toFixed(1).replace(".", ",")} M`;
  if (n >= 1e6) return `Rp ${Math.round(n / 1e6)} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

const IKON_CEK: Record<CekHasil, string> = { OK: "✅", WARN: "🟡", FAIL: "🔴", NA: "—" };
const IKON_STATUS: Record<HodStatus, string> = { SIAP: "✅", "PERLU KLARIFIKASI": "🟡", "TIDAK SIAP": "🔴" };
const IKON_HEALTH: Record<Health, string> = { RED: "🔴", RISK: "🟡", "ON-TRACK": "🟢" };
const REKOMENDASI: Record<HodStatus, string> = {
  SIAP: "Bahas normal",
  "PERLU KLARIFIKASI": "Minta klarifikasi dulu",
  "TIDAK SIAP": "Tunda / minta data dilengkapi",
};

export function alasanHealth(hods: HodBrief[]): string {
  const n = (s: HodStatus) => hods.filter((h) => h.status === s).length;
  return `${n("SIAP")} SIAP · ${n("PERLU KLARIFIKASI")} perlu klarifikasi · ${n("TIDAK SIAP")} tidak siap`;
}

/** Bagian deterministik brief (markdown) — selalu ada walau LLM gagal. */
export function formatBagianData(label: string, periode: string, health: Health, hods: HodBrief[]): string {
  const baris = [
    `# Senin Brief ${label} — ${periode}`,
    "",
    `**Overall Health: ${IKON_HEALTH[health]} ${health}** (${alasanHealth(hods)})`,
    "",
    "## Tabel Ringkasan",
    "",
    "| HoD | Divisi | Status | 1 | 2 | 3 | 4 | 5 | Rekomendasi |",
    "|---|---|---|---|---|---|---|---|---|",
    ...hods.map((h) =>
      `| ${h.nama} | ${h.peran} | ${IKON_STATUS[h.status]} ${h.status} | ${h.checks.map((c) => IKON_CEK[c.hasil]).join(" | ")} | ${REKOMENDASI[h.status]} |`),
    "",
    `Cek: ${Object.entries(LABEL_CEK).map(([no, l]) => `${no} ${l}`).join(" · ")}. — = tak berlaku.`,
    "",
    "## Detail Cek per HoD",
    "",
  ];
  for (const h of hods) {
    baris.push(`### ${h.nama} — ${h.peran} · ${IKON_STATUS[h.status]} ${h.status}`);
    for (const c of h.checks) baris.push(`- ${IKON_CEK[c.hasil]} **${c.no}. ${c.label}** — ${c.detail}`);
    baris.push("");
  }
  return baris.join("\n");
}

/** Ringkasan WA untuk Direktur — satu layar, tanpa kurung sudut (dibuang WA). */
export function formatWa(label: string, periode: string, health: Health, hods: HodBrief[], link: string | null): string {
  const grup = (s: HodStatus) => hods.filter((h) => h.status === s).map((h) => h.nama);
  const baris = [
    `*Senin Brief ${label}* · ${periode}`,
    `Overall Health: ${IKON_HEALTH[health]} *${health}*`,
    "",
  ];
  const urut: HodStatus[] = ["TIDAK SIAP", "PERLU KLARIFIKASI", "SIAP"];
  for (const s of urut) {
    const nama = grup(s);
    if (nama.length) baris.push(`${IKON_STATUS[s]} ${s} (${nama.length}): ${nama.join(", ")}`);
  }
  const tidakSiap = hods.filter((h) => h.status === "TIDAK SIAP");
  if (tidakSiap.length) {
    baris.push("", "*Kenapa tidak siap:*");
    for (const h of tidakSiap) {
      const gagal = h.checks.filter((c) => c.hasil === "FAIL").map((c) => c.label);
      baris.push(`• ${h.nama}: ${gagal.join(", ")}`);
    }
  }
  if (link) baris.push("", `Detail, pertanyaan kritis & usulan keputusan: ${link}`);
  return baris.join("\n");
}

// ── Pengumpulan data ─────────────────────────────────────────────

async function pipelinePerHod(): Promise<Map<string, PipelineAgg>> {
  const rows = await db()`
    SELECT lower(pic_hod) AS k,
      count(*)::int AS n,
      count(*) FILTER (WHERE COALESCE(estimated_value, estimate_amount, 0) > 0
                         AND probability IS NOT NULL
                         AND purchase_month IS NOT NULL AND purchase_year IS NOT NULL)::int AS lengkap,
      count(*) FILTER (WHERE stage_entered_at < now() - make_interval(days => ${HARI_BASI_DEAL}))::int AS basi,
      COALESCE(sum(COALESCE(estimated_value, estimate_amount, 0)), 0)::float8 AS nilai,
      COALESCE(sum(COALESCE(estimated_value, estimate_amount, 0) * COALESCE(probability, 0)), 0)::float8 AS weighted
    FROM deal
    WHERE stage NOT IN ('Closing-Won', 'Closing-Lost') AND NOT on_hold AND pic_hod IS NOT NULL
    GROUP BY lower(pic_hod)
  `;
  return new Map(rows.map((r) => [String(r.k), {
    n: Number(r.n), lengkap: Number(r.lengkap), basi: Number(r.basi), nilai: Number(r.nilai), weighted: Number(r.weighted),
  }]));
}

/** Umur (hari) input manual WatchPoint terakhir per HoD — papan live maupun mingguan. */
async function manualTerakhir(): Promise<Map<string, number>> {
  const rows = await db()`
    SELECT hod_key, (CURRENT_DATE - max(updated_at)::date)::int AS umur FROM (
      SELECT hod_key, updated_at FROM watchpoint_metric
      UNION ALL
      SELECT hod_key, updated_at FROM watchpoint_weekly WHERE source = 'manual'
    ) x GROUP BY hod_key
  `;
  return new Map(rows.map((r) => [String(r.hod_key), Number(r.umur)]));
}

async function direkturTarget(): Promise<string | null> {
  const env = process.env.SENIN_BRIEF_TARGET?.trim();
  if (env) return env;
  // Sama dengan approval.ts: akun direktur tertua yang punya nomor WA.
  const rows = await db()`
    SELECT wa_number FROM app_user
    WHERE role = 'direktur' AND wa_number IS NOT NULL AND wa_number <> ''
    ORDER BY created_at LIMIT 1
  `;
  return rows.length ? String(rows[0].wa_number) : null;
}

export interface SeninBriefResult {
  iso_year: number;
  iso_week: number;
  health: Health;
  stored: boolean;
  narasi_ok: boolean;
  model?: string | null;
  narasi_error?: string;
  wa?: { target: string | null; sent: boolean; error?: string; skipped?: string };
  hods: { hod_key: string; status: HodStatus }[];
}

/**
 * Susun brief untuk minggu ISO yang baru tutup (default) → simpan (UPSERT per
 * minggu) → kirim WA ke Direktur. `dryRun` = hitung & susun saja, tanpa simpan
 * dan tanpa WA. `kirimWa=false` = simpan tanpa WA (generate ulang manual).
 */
export async function runSeninBrief(opts: {
  dryRun?: boolean; kirimWa?: boolean; isoYear?: number; isoWeek?: number;
} = {}): Promise<SeninBriefResult & { content?: string; wa_preview?: string }> {
  const cur = currentWeek();
  const barusTutup = previousWeek(cur.isoYear, cur.isoWeek);
  const minggu = opts.isoYear && opts.isoWeek ? { isoYear: opts.isoYear, isoWeek: opts.isoWeek } : barusTutup;
  const { from, to } = weekRange(minggu.isoYear, minggu.isoWeek);
  const label = `W${minggu.isoWeek}`;
  // Rapat jatuh di minggu SESUDAH yang dinilai — jangkar tenggat di narasi LLM
  // (tanpa ini model menulis "Rabu W40" untuk minggu yang sudah lewat).
  const rapat = isoWeekOf(new Date(new Date(`${weekRange(minggu.isoYear, minggu.isoWeek).to}T00:00:00Z`).getTime() + 86_400_000));
  const labelRapat = `W${rapat.isoWeek}`;
  const periode = periodeLabel(from, to);

  // Pastikan metric DB minggu itu sudah dibekukan. Biasanya sudah oleh job
  // watchpoint-snapshot 06:00; tanpa snapshot, metric DB minggu lewat terbaca
  // kosong dan cek 1/4 memvonis HoD sales "belum isi" — salah alamat.
  // Idempoten & tak menimpa input manual HoD. Dilewati saat dry-run (tanpa tulis).
  // HANYA untuk minggu yang baru tutup: mode 'live' menghitung metric titik-waktu
  // per hari ini, jadi memanggilnya untuk minggu lama akan menimpa riwayat.
  if (!opts.dryRun && minggu.isoYear === barusTutup.isoYear && minggu.isoWeek === barusTutup.isoWeek) {
    await snapshotWeek(minggu.isoYear, minggu.isoWeek);
  }

  const [board, hodRows, mirror, pipeline, kepatuhanRows, manual] = await Promise.all([
    getWeeklyBoard(minggu.isoYear, minggu.isoWeek),
    listHods(),
    mirrorFreshness(),
    pipelinePerHod(),
    reportPerHod(from, to),
    manualTerakhir(),
  ]);

  const terburuk = mirror.sumber.reduce<number | null>(
    (a, s) => (s.umurHari === null ? a : a === null ? s.umurHari : Math.max(a, s.umurHari)), null);
  const mirrorInfo: MirrorInfo = { ok: mirror.ok, terburukHari: terburuk };
  // reportPerHod mengelompokkan per hod_panggilan (huruf besar, dari master_territory).
  const kepatuhan = new Map(kepatuhanRows.map((k) => [k.hod.toUpperCase(), k]));
  const metaHod = new Map(hodRows.map((h) => [h.key, h]));
  const defs = listMetricDefs();
  const otomatisOf = (hodKey: string) => new Set(defs.filter((d) => d.hodKey === hodKey && d.computed).map((d) => d.metricKey));

  const hods: HodBrief[] = board.hods.map((h) => {
    const meta = metaHod.get(h.key);
    return nilaiHod(h, { nama: meta?.panggilan ?? h.name, peran: meta?.peran ?? h.role }, {
      mirror: mirrorInfo,
      pipeline: pipeline.get(h.key),
      kepatuhan: meta ? kepatuhan.get(meta.panggilan.toUpperCase()) : undefined,
      manualTerakhirHari: manual.get(h.key) ?? null,
      otomatis: otomatisOf(h.key),
    });
  });
  const health = overallHealth(hods.map((h) => h.status));
  const bagianData = formatBagianData(label, periode, health, hods);

  // Narasi LLM — konteks angka WatchPoint ikut dikirim supaya pertanyaan kritis
  // berpijak pada metric sungguhan, bukan karangan.
  const { status, data } = await callAi("/senin-brief", {
    minggu_label: label,
    minggu_rapat: labelRapat,
    periode,
    health,
    hods: hods.map((h) => {
      const wb = board.hods.find((b) => b.key === h.hod_key);
      return {
        ...h,
        metrics: (wb?.metrics ?? []).map((m) => ({
          label: m.label, status: m.status, trend: m.trend,
          actual: fmtValue(m.actual, m.unit), target: fmtValue(m.target, m.unit),
        })),
      };
    }),
    dry_run: aiDryRun(),
  }, { timeoutMs: 120_000 }).catch((e: unknown) => ({
    // services/ai tak terjangkau (mati / timeout / DNS) MELEMPAR, bukan membalas
    // status. Tanpa penangkap ini seluruh generasi Senin Brief gagal — padahal
    // tabel & cek deterministik di atas sudah dihitung dari data dan tetap
    // berguna tanpa narasi. Dipetakan ke 503 supaya jatuh ke cabang
    // `status !== 200` yang sudah ada: brief tetap terbit, narasinya diganti
    // peringatan. (Dari `main`, hilang di `dev` — lihat PR back-merge ini.)
    status: 503,
    data: { error: `services/ai tak terjangkau (/senin-brief): ${e instanceof Error ? e.message : String(e)}` } as Record<string, unknown>,
  }));
  const narasi = status === 200 ? String(data.narasi ?? "").trim() : "";
  const narasiOk = narasi.length >= 50 && !data.dry_run;
  const content = narasiOk
    ? `${bagianData}\n${narasi}\n`
    : `${bagianData}\n> ⚠️ Narasi AI (gap utama, pertanyaan kritis, usulan keputusan) tidak tersedia minggu ini${status !== 200 ? ` — ${String(data.error ?? `services/ai ${status}`)}` : data.dry_run ? " — mode dry-run" : ""}. Tabel & detail cek di atas tetap dihitung dari data.\n`;
  const model = data.model ? String(data.model) : null;

  const hasil: SeninBriefResult & { content?: string } = {
    iso_year: minggu.isoYear, iso_week: minggu.isoWeek, health,
    stored: false, narasi_ok: narasiOk, model,
    narasi_error: narasiOk ? undefined : String(data.error ?? (data.dry_run ? "dry-run" : "narasi kosong")),
    hods: hods.map((h) => ({ hod_key: h.hod_key, status: h.status })),
  };
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const waText = formatWa(label, periode, health, hods, base ? `${base}/briefings?tab=senin` : null);
  // Dry-run ikut mengembalikan teks WA persis — operator bisa melihat pesan yang
  // AKAN diterima Direktur sebelum flag dinyalakan.
  if (opts.dryRun) return { ...hasil, content, wa_preview: waText };

  const sql = db();
  const [row] = await sql`
    INSERT INTO senin_brief (iso_year, iso_week, periode, health, checks, content, narasi_ok, model_used)
    VALUES (${minggu.isoYear}, ${minggu.isoWeek}, ${periode}, ${health},
            ${sql.json(hods as unknown as Parameters<typeof sql.json>[0])}, ${content}, ${narasiOk}, ${model})
    ON CONFLICT (iso_year, iso_week) DO UPDATE SET
      periode = EXCLUDED.periode, health = EXCLUDED.health, checks = EXCLUDED.checks,
      content = EXCLUDED.content, narasi_ok = EXCLUDED.narasi_ok, model_used = EXCLUDED.model_used,
      generated_at = now()
    RETURNING id
  `;
  hasil.stored = true;

  if (opts.kirimWa === false) {
    hasil.wa = { target: null, sent: false, skipped: "kirimWa=false" };
    return hasil;
  }
  const target = await direkturTarget();
  if (!target) {
    hasil.wa = { target: null, sent: false, error: "nomor WA Direktur tak ditemukan (app_user role direktur / SENIN_BRIEF_TARGET)" };
    // Tiap percobaan kirim menimpa SEMUA kolom wa_* — sisa sukses minggu yang sama
    // dari generate sebelumnya tak boleh bersanding dengan error baru.
    await sql`UPDATE senin_brief SET wa_target = NULL, wa_sent_at = NULL, wa_error = ${hasil.wa.error!} WHERE id = ${row.id}`;
    return hasil;
  }
  const r = await sendViaWaGateway(target, waText);
  hasil.wa = { target, sent: r.sent, error: r.error };
  await sql`
    UPDATE senin_brief SET wa_target = ${target},
      wa_sent_at = ${r.sent ? sql`now()` : null}, wa_error = ${r.error ?? null}
    WHERE id = ${row.id}
  `;
  return hasil;
}

export interface SeninBriefRow {
  id: string;
  iso_year: number;
  iso_week: number;
  periode: string;
  health: Health;
  checks: HodBrief[];
  content: string;
  narasi_ok: boolean;
  model_used: string | null;
  /** Nomor tujuan TIDAK diekspos ke web (dibaca semua pemegang menu /briefings). */
  wa_terkirim: boolean;
  wa_sent_at: string | null;
  wa_error: string | null;
  generated_at: string;
}

function mapRow(r: Record<string, unknown>): SeninBriefRow {
  return {
    id: String(r.id), iso_year: Number(r.iso_year), iso_week: Number(r.iso_week),
    periode: String(r.periode), health: r.health as Health, checks: (r.checks ?? []) as HodBrief[],
    content: String(r.content), narasi_ok: Boolean(r.narasi_ok),
    model_used: r.model_used ? String(r.model_used) : null,
    wa_terkirim: r.wa_sent_at !== null,
    wa_sent_at: r.wa_sent_at ? String(r.wa_sent_at) : null,
    wa_error: r.wa_error ? String(r.wa_error) : null,
    generated_at: String(r.generated_at),
  };
}

export async function listSeninBriefs(limit = 12): Promise<SeninBriefRow[]> {
  const rows = await db()`
    SELECT id::text, iso_year, iso_week, periode, health, checks, content, narasi_ok, model_used,
           wa_sent_at::text, wa_error, generated_at::text
    FROM senin_brief ORDER BY iso_year DESC, iso_week DESC LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

/** Satu brief (untuk PDF F110). Tanpa argumen = brief terbaru; null bila tak ada. */
export async function getSeninBrief(isoYear?: number, isoWeek?: number): Promise<SeninBriefRow | null> {
  const rows = isoYear && isoWeek
    ? await db()`
        SELECT id::text, iso_year, iso_week, periode, health, checks, content, narasi_ok, model_used,
               wa_sent_at::text, wa_error, generated_at::text
        FROM senin_brief WHERE iso_year = ${isoYear} AND iso_week = ${isoWeek}`
    : await db()`
        SELECT id::text, iso_year, iso_week, periode, health, checks, content, narasi_ok, model_used,
               wa_sent_at::text, wa_error, generated_at::text
        FROM senin_brief ORDER BY iso_year DESC, iso_week DESC LIMIT 1`;
  return rows.length ? mapRow(rows[0]) : null;
}

// ── #BRIEFING (WA) — F110 ────────────────────────────────────────

export type ArgBriefing = { tahun?: number; minggu?: number } | { error: string };

/**
 * Argumen hashtag: kosong = brief terbaru; `W41` / `41` = minggu itu di tahun
 * ISO berjalan; `2026 W41` = tahun eksplisit. Minggu ISO 1–53.
 */
export function parseBriefingArg(arg: string, tahunIni: number): ArgBriefing {
  const t = arg.trim();
  if (!t) return {};
  const m = /^(?:(\d{4})\s*[-/ ]?\s*)?w?\s*(\d{1,2})$/i.exec(t);
  if (!m) return { error: "format" };
  const minggu = Number(m[2]);
  if (minggu < 1 || minggu > 53) return { error: "format" };
  return { tahun: m[1] ? Number(m[1]) : tahunIni, minggu };
}

/** Balasan WA untuk #BRIEFING: ringkasan F85 yang sama dgn WA Senin + jejak waktu susun. */
export function formatBalasanBriefing(b: SeninBriefRow, link: string | null): string {
  const label = `W${b.iso_week}`;
  const baris = [formatWa(label, b.periode, b.health, b.checks, link)];
  const disusun = new Date(b.generated_at).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  });
  baris.push("", `_Disusun ${disusun}${b.narasi_ok ? "" : " · narasi AI tak tersedia"}_`);
  return baris.join("\n");
}

/** Dipanggil handler #BRIEFING (pengirim sudah divalidasi Direktur/admin oleh inbound). */
export async function balasanBriefing(arg: string): Promise<string> {
  const parsed = parseBriefingArg(arg, currentWeek().isoYear);
  if ("error" in parsed) {
    return "⚠️ Format #BRIEFING: kirim #BRIEFING untuk brief terbaru, atau #BRIEFING W41 untuk minggu tertentu.";
  }
  const brief = await getSeninBrief(parsed.tahun, parsed.minggu);
  if (!brief) {
    return parsed.minggu
      ? `Belum ada Senin Brief untuk W${parsed.minggu} ${parsed.tahun}.`
      : "Belum ada Senin Brief. Job senin-brief menyusunnya tiap Senin 06:30.";
  }
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  return formatBalasanBriefing(brief, base ? `${base}/briefings?tab=senin` : null);
}
