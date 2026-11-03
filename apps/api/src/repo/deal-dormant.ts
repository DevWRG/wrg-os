// Pipeline Dormant (migrasi 273) — job harian deal-dormant.
//
// Urutan per run (urutannya penting):
//   1. LEPAS  — deal yang sudah bergerak lagi sesudah dormant_at, sudah Won/Lost
//               lewat jalur lain, atau di-on-hold → penanda dibersihkan.
//   2. GUGUR  — Dormant ≥ GUGUR_HARI dan tetap diam → Closing-Lost, alasan
//               'tidak-bergerak', loss_status approved (tanpa antrean HoD).
//   3. TANDAI — deal jalan yang ≥ DORMANT_HARI tanpa pergerakan → dormant_at.
//   4. WA     — satu ringkasan per AM (Dormant baru · segera gugur · gugur) dan
//               satu per HoD (Dormant baru · gugur).
// Gugur dikerjakan SEBELUM tandai: deal yang baru ditandai hari ini tak mungkin
// gugur di run yang sama, jadi saat job pertama kali dinyalakan semua deal lama
// cuma jadi Dormant dan hitungan 15 hari dimulai dari hari itu.
//
// Penanda WA HANYA ditulis bila pesan benar-benar terkirim live (bukan stub /
// dry-run) — pola runLeadAging. Penerima tanpa nomor WA dilewati, dicatat.
// Mode dryRun: hitung saja, tanpa tulis DB dan tanpa WA.
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { waHod } from "./hod-wa.js";
import {
  DORMANT_ACTOR, DORMANT_HARI, GUGUR_HARI, LOSS_TIDAK_BERGERAK, STAGE_META, lastActivitySql,
} from "./deal.js";

/** Berapa hari sebelum gugur AM diingatkan sekali lagi. */
export const INGAT_HARI = 3;

const STAGE_SHORT: Record<string, string> = {
  Prospecting: "Prospek", Presentation: "Presentasi", Quotation: "Penawaran",
  Negotiation: "Negosiasi", Closing: "Closing",
};
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (d: Date) => `${d.getDate()} ${BULAN[d.getMonth()]}`;

export interface DormantItem {
  deal_id: string;
  faskes: string;
  produk: string | null;
  stage: string;
  am_id: string | null;
  am_nama: string | null;
  am_wa: string | null;
  pic_hod: string | null;
  gugur_at: Date;           // untuk "gugur" = saat dipindah ke Lost
}

const baris = (x: DormantItem, denganAm: boolean, tanggal: string) =>
  `• ${x.faskes}${x.produk ? ` — ${x.produk}` : ""} · ${STAGE_SHORT[x.stage] ?? x.stage} · ${tanggal}` +
  (denganAm ? ` · ${x.am_nama ?? "BELUM ADA AM"}` : "");

function daftar(xs: DormantItem[], denganAm: boolean, tanggal: (x: DormantItem) => string): string[] {
  const out = xs.slice(0, 15).map((x) => baris(x, denganAm, tanggal(x)));
  if (xs.length > 15) out.push(`…dan ${xs.length - 15} deal lain`);
  return out;
}

/** Ringkasan WA untuk satu AM. Fungsi murni (diuji). Kosong semua → "". */
export function pesanDormantAm(nama: string, g: { baru: DormantItem[]; ingat: DormantItem[]; gugur: DormantItem[] }): string {
  const bag: string[] = [];
  if (g.baru.length) {
    bag.push(`💤 *Deal Dormant* — ${nama}, ${g.baru.length} deal sudah ${DORMANT_HARI} hari tanpa pergerakan:`,
      ...daftar(g.baru, false, (x) => `gugur ${tgl(x.gugur_at)}`), "");
  }
  if (g.ingat.length) {
    bag.push(`⏳ *Segera gugur* — ${g.ingat.length} deal Dormant jadi Lost dalam ${INGAT_HARI} hari:`,
      ...daftar(g.ingat, false, (x) => `gugur ${tgl(x.gugur_at)}`), "");
  }
  if (g.gugur.length) {
    bag.push(`❌ *Deal gugur jadi Lost* — ${g.gugur.length} deal ${DORMANT_HARI + GUGUR_HARI}+ hari tanpa pergerakan:`,
      ...daftar(g.gugur, false, () => "Lost"), "");
  }
  if (!bag.length) return "";
  bag.push(
    g.baru.length || g.ingat.length
      ? `Supaya Dormant lepas: kirim #REPORT untuk faskesnya, pindahkan tahap, atau edit deal di menu Pipeline. Tanpa pergerakan ${GUGUR_HARI} hari, deal otomatis jadi *Lost*.`
      : "Deal yang ternyata masih jalan bisa dipindah lagi dari kolom Lost di menu Pipeline.",
  );
  return bag.join("\n");
}

/** Ringkasan WA untuk satu HoD. Fungsi murni (diuji). Kosong semua → "". */
export function pesanDormantHod(nama: string, g: { baru: DormantItem[]; gugur: DormantItem[] }): string {
  const bag: string[] = [];
  if (g.baru.length) {
    bag.push(`💤 *Deal tim jadi Dormant* — ${nama}, ${g.baru.length} deal ${DORMANT_HARI} hari tanpa pergerakan:`,
      ...daftar(g.baru, true, (x) => `gugur ${tgl(x.gugur_at)}`), "");
  }
  if (g.gugur.length) {
    bag.push(`❌ *Deal tim gugur jadi Lost* — ${g.gugur.length} deal:`, ...daftar(g.gugur, true, () => "Lost"), "");
  }
  if (!bag.length) return "";
  bag.push("Cek di menu Pipeline → kartu Dormant. AM sudah diingatkan lewat WA.");
  return bag.join("\n");
}

type Row = Record<string, unknown>;
const toItem = (r: Row, gugurAt: Date): DormantItem => ({
  deal_id: String(r.deal_id),
  faskes: String(r.facility_name || r.customer_name || "—"),
  produk: r.product ? String(r.product) : null,
  stage: String(r.stage),
  am_id: r.am_id ? String(r.am_id) : null,
  am_nama: r.am_nama ? String(r.am_nama) : null,
  am_wa: r.am_wa ? String(r.am_wa) : null,
  pic_hod: r.pic_hod ? String(r.pic_hod) : null,
  gugur_at: gugurAt,
});

export interface DormantRunResult {
  dry_run: boolean;
  lepas: number;
  gugur: number;
  tandai: number;
  dormant_total: number;
  wa_am: number;
  wa_hod: number;
  lewati: string[];
}

export async function runDealDormant(opts: { dryRun?: boolean } = {}): Promise<DormantRunResult> {
  const sql = db();
  const dry = opts.dryRun ?? false;
  const last = lastActivitySql(sql);
  // Deal jalan & tidak ditahan. on_hold dikecualikan — konvensi yang sama dengan
  // Keaslian Pipeline & Senin Brief: deal yang sengaja ditahan tak dinilai diamnya.
  const OPEN = sql`d.stage NOT IN ('Closing-Won', 'Closing-Lost') AND NOT COALESCE(d.on_hold, false)`;
  const lewati: string[] = [];
  const amCols = sql`NULLIF(mu.nama, '') AS am_nama, NULLIF(btrim(mu.wa_number), '') AS am_wa`;

  // 1. LEPAS
  let lepas: number;
  if (dry) {
    const [c] = await sql`SELECT count(*)::int AS n FROM deal d
      WHERE d.dormant_at IS NOT NULL AND (NOT (${OPEN}) OR ${last} > d.dormant_at)`;
    lepas = Number(c.n);
  } else {
    const r = await sql`UPDATE deal d SET dormant_at = NULL, dormant_wa_am_at = NULL, dormant_wa_hod_at = NULL, dormant_ingat_at = NULL
      WHERE d.dormant_at IS NOT NULL AND (NOT (${OPEN}) OR ${last} > d.dormant_at)
      RETURNING d.deal_id`;
    lepas = r.length;
  }

  // 2. GUGUR
  const calonGugur = await sql`
    SELECT d.deal_id, d.facility_name, d.customer_name, d.product, d.stage, d.am_id, d.pic_hod, d.dormant_at, ${amCols}
    FROM deal d LEFT JOIN master_user mu ON mu.am_id = d.am_id
    WHERE ${OPEN} AND d.dormant_at IS NOT NULL
      AND d.dormant_at <= now() - make_interval(days => ${GUGUR_HARI})
      AND ${last} <= d.dormant_at`;
  const gugur: DormantItem[] = [];
  const lost = STAGE_META["Closing-Lost"];
  for (const r of calonGugur) {
    const sejak = new Date(r.dormant_at as string);
    if (dry) { gugur.push(toItem(r, new Date())); continue; }
    // Satu statement (atomik): ubah deal + catat Riwayat. Guard ulang di WHERE —
    // kalau AM bergerak di antara SELECT dan UPDATE, deal itu tak ikut gugur.
    const u = await sql`
      WITH u AS (
        UPDATE deal d SET stage = 'Closing-Lost', prospect_category = ${lost.prospect || null},
          probability = ${lost.prob}, forecast_category = ${lost.forecast},
          loss_reason = ${LOSS_TIDAK_BERGERAK}::deal_loss_reason, loss_status = 'approved',
          loss_approved_by = ${DORMANT_ACTOR}, loss_approved_at = now(),
          stage_entered_at = now(), updated_at = now(),
          dormant_at = NULL, dormant_wa_am_at = NULL, dormant_wa_hod_at = NULL, dormant_ingat_at = NULL
        WHERE d.deal_id = ${r.deal_id as string} AND ${OPEN} AND d.dormant_at IS NOT NULL AND ${last} <= d.dormant_at
        RETURNING d.deal_id
      )
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      SELECT u.deal_id, ${r.stage as string}, 'Closing-Lost', ${DORMANT_ACTOR},
        ${`loss: ${LOSS_TIDAK_BERGERAK} | gugur otomatis — Dormant sejak ${tgl(sejak)}, ${GUGUR_HARI} hari tetap tanpa pergerakan`}
      FROM u RETURNING deal_id`;
    if (u.length > 0) gugur.push(toItem(r, new Date()));
  }

  // 3. TANDAI — dormant_at = now(); updated_at sengaja TIDAK disentuh (itu
  // pergerakan) dan entri Riwayat ditulis atas nama DORMANT_ACTOR (dikecualikan).
  let tandai: number;
  if (dry) {
    const [c] = await sql`SELECT count(*)::int AS n FROM deal d
      WHERE ${OPEN} AND d.dormant_at IS NULL AND ${last} < now() - make_interval(days => ${DORMANT_HARI})`;
    tandai = Number(c.n);
  } else {
    const r = await sql`
      WITH t AS (
        UPDATE deal d SET dormant_at = now()
        WHERE ${OPEN} AND d.dormant_at IS NULL AND ${last} < now() - make_interval(days => ${DORMANT_HARI})
        RETURNING d.deal_id, d.stage
      )
      INSERT INTO spt_state_log (deal_id, from_stage, to_stage, changed_by, reason)
      SELECT t.deal_id, t.stage, t.stage, ${DORMANT_ACTOR},
        ${`Dormant: ${DORMANT_HARI} hari tanpa pergerakan — otomatis Lost bila ${GUGUR_HARI} hari lagi tetap diam`}
      FROM t RETURNING deal_id`;
    tandai = r.length;
  }

  // Total Dormant sesudah run (dry: perkiraan = yang sudah + yang akan ditandai − yang gugur).
  const [tot] = await sql`SELECT count(*)::int AS n FROM deal d WHERE ${OPEN} AND d.dormant_at IS NOT NULL AND ${last} <= d.dormant_at`;
  const dormantTotal = dry ? Number(tot.n) + tandai - gugur.length : Number(tot.n);

  if (dry) return { dry_run: true, lepas, gugur: gugur.length, tandai, dormant_total: dormantTotal, wa_am: 0, wa_hod: 0, lewati };

  // 4. WA
  const aktif = await sql`
    SELECT d.deal_id, d.facility_name, d.customer_name, d.product, d.stage, d.am_id, d.pic_hod,
      d.dormant_at, d.dormant_wa_am_at, d.dormant_wa_hod_at, d.dormant_ingat_at, ${amCols}
    FROM deal d LEFT JOIN master_user mu ON mu.am_id = d.am_id
    WHERE ${OPEN} AND d.dormant_at IS NOT NULL AND ${last} <= d.dormant_at
      AND (d.dormant_wa_am_at IS NULL OR d.dormant_wa_hod_at IS NULL
           OR (d.dormant_ingat_at IS NULL AND d.dormant_at <= now() - make_interval(days => ${GUGUR_HARI - INGAT_HARI})))`;
  const itemOf = (r: Row) => toItem(r, new Date(new Date(r.dormant_at as string).getTime() + GUGUR_HARI * 86_400_000));
  const ingatBatas = Date.now() - (GUGUR_HARI - INGAT_HARI) * 86_400_000;

  const perAm = new Map<string, { baru: DormantItem[]; ingat: DormantItem[]; gugur: DormantItem[] }>();
  const slot = (am: string) => perAm.get(am) ?? perAm.set(am, { baru: [], ingat: [], gugur: [] }).get(am)!;
  for (const r of aktif) {
    if (!r.am_id) continue;
    if (r.dormant_wa_am_at == null) slot(String(r.am_id)).baru.push(itemOf(r));
    else if (r.dormant_ingat_at == null && new Date(r.dormant_at as string).getTime() <= ingatBatas) slot(String(r.am_id)).ingat.push(itemOf(r));
  }
  for (const x of gugur) if (x.am_id) slot(x.am_id).gugur.push(x);

  let waAm = 0;
  for (const [amId, g] of perAm) {
    const contoh = g.baru[0] ?? g.ingat[0] ?? g.gugur[0];
    if (!contoh.am_wa) { lewati.push(`AM ${amId}: nomor WA kosong`); continue; }
    const pesan = pesanDormantAm(contoh.am_nama ?? amId, g);
    if (!pesan) continue;
    const gw = await sendViaWaGateway(contoh.am_wa, pesan);
    if (gw.sent && !gw.stub && !gw.dryRun) {
      if (g.baru.length) await sql`UPDATE deal SET dormant_wa_am_at = now() WHERE deal_id = ANY(${g.baru.map((x) => x.deal_id)}::uuid[])`;
      if (g.ingat.length) await sql`UPDATE deal SET dormant_ingat_at = now() WHERE deal_id = ANY(${g.ingat.map((x) => x.deal_id)}::uuid[])`;
      waAm += 1;
    }
  }

  const perHod = new Map<string, { baru: DormantItem[]; gugur: DormantItem[] }>();
  const slotH = (h: string) => perHod.get(h) ?? perHod.set(h, { baru: [], gugur: [] }).get(h)!;
  for (const r of aktif) {
    if (r.dormant_wa_hod_at != null) continue;
    if (r.pic_hod) slotH(String(r.pic_hod)).baru.push(itemOf(r));
  }
  for (const x of gugur) if (x.pic_hod) slotH(x.pic_hod).gugur.push(x);

  let waHodN = 0;
  for (const [hodKey, g] of perHod) {
    const u = await waHod(hodKey);
    if (!u) { lewati.push(`HoD ${hodKey}: nomor WA tak ditemukan`); continue; }
    const pesan = pesanDormantHod(u.nama, g);
    if (!pesan) continue;
    const gw = await sendViaWaGateway(u.wa, pesan);
    if (gw.sent && !gw.stub && !gw.dryRun) {
      if (g.baru.length) await sql`UPDATE deal SET dormant_wa_hod_at = now() WHERE deal_id = ANY(${g.baru.map((x) => x.deal_id)}::uuid[])`;
      waHodN += 1;
    }
  }

  return { dry_run: false, lepas, gugur: gugur.length, tandai, dormant_total: dormantTotal, wa_am: waAm, wa_hod: waHodN, lewati };
}
