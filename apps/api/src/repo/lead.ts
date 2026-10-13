// F65 Leads Capture & Qualification (+ auto-routing) — migrasi 209.
//
// Keputusan user 2026-10-13: lead = tabel TERPISAH dari deal; lolos kualifikasi
// bila BANT ≥ 3 dari 4; sumber v1 = WA #LEADS, form web, impor pameran; lead
// berstatus 'baru' diingatkan ke AM setelah 3 hari kerja dan ke HoD setelah 7.
//
// Routing (resolveWilayah):
//   kota → AM      : master_territory — satu-satunya peta kota→AM. Kota yang
//                    dipegang >1 AM TIDAK ditebak (pola import_pameran.py).
//   AM  → cabang   : master_user.cabang (penamaan dashboard, mis. 'SBY 2').
//   kota → cabang  : area_kota, bila AM tak terpetakan.
//   cabang → HoD   : hod_territory. master_territory memakai penamaan cabang
//                    LAMA ('SURABAYA 2', 'JAWA TENGAH') — jangan pernah dipakai
//                    sebagai nilai lead.cabang: gerbang scope HoD membandingkan
//                    cabang persis dengan hod_territory.
//
// Scope baris: AM = lead miliknya; HoD = lead ber-cabang timnya (termasuk yang
// belum ber-AM); admin = semua. Lead tanpa cabang & tanpa AM hanya terlihat
// admin — sama dengan akun tak-bertuan di Accounts.

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { scopeOnClause, type DataScope } from "./access-scope.js";
import { createDeal } from "./deal.js";
import { cariAkun } from "./interaction.js";
import { sendViaWaGateway } from "../wasend.js";

export const LEAD_SOURCES = ["wa", "web", "pameran", "referral", "telepon", "lpse", "lainnya"] as const;
export const LEAD_STATUSES = ["baru", "dihubungi", "dikonversi", "ditolak"] as const;
export const BANT_LOLOS = 3;
export const AGING_HARI_AM = 3;
export const AGING_HARI_HOD = 7;

export class LeadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Murni (diuji tanpa DB) ──────────────────────────────────────────────────

/** Samakan penulisan kota: 'Kab. Ngawi' / 'KABUPATEN NGAWI' / 'ngawi' → 'ngawi'. */
export function normKota(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(kotamadya|kabupaten|kota|kab|kodya)\s+/, "")
    .trim();
}

export interface BarisTerritory { am_panggilan: string; hod_panggilan: string | null; kota: string }

/**
 * Pilih AM untuk satu kota dari baris master_territory. Hasil null bila kota
 * tak ada di peta ATAU dipegang lebih dari satu AM (tak ditebak).
 */
export function pilihAmWilayah(kota: string, rows: BarisTerritory[]): { am_panggilan: string; hod_panggilan: string | null } | null | "ambigu" {
  const k = normKota(kota);
  if (!k) return null;
  const cocok = rows.filter((r) => normKota(r.kota) === k);
  const am = [...new Set(cocok.map((r) => r.am_panggilan.trim().toUpperCase()))];
  if (am.length === 0) return null;
  if (am.length > 1) return "ambigu";
  const r = cocok[0];
  return { am_panggilan: am[0], hod_panggilan: r.hod_panggilan };
}

export type ParseLeads =
  | { ok: true; facility_name: string; city: string | null; kebutuhan: string | null }
  | { ok: false; alasan: "kosong" | "terlalu-panjang" };

const LEADS_LINE = /^\s*#\s*leads\b/i;

/**
 * `#LEADS <faskes>, <kota>: <kebutuhan>` — kota & kebutuhan opsional.
 *   #LEADS RSUD dr Soedono, Madiun: butuh analyzer hematologi, pagu 2027
 *   #LEADS Klinik Sehat Jaya, Kediri
 *   #LEADS RS Islam Jemursari
 *   kebutuhan bisa juga di baris-baris berikutnya (pesan yang SAMA).
 * Kota = bagian sesudah koma TERAKHIR sebelum titik dua — nama Accurate
 * bergaya "WIDODO, RS" jarang diketik orang, dan salah tebak kota cuma
 * berakibat lead belum ber-AM (routing manual), bukan salah tempel.
 */
export function parseLeads(body: string | null): ParseLeads {
  if (!body) return { ok: false, alasan: "kosong" };
  const lines = stripInvisible(body).split(/\r?\n/);
  const idx = lines.findIndex((l) => LEADS_LINE.test(l));
  if (idx < 0) return { ok: false, alasan: "kosong" };
  const arg = lines[idx].replace(LEADS_LINE, "").trim();
  const lanjutan = lines.slice(idx + 1).join("\n").trim();
  const ti = arg.indexOf(":");
  const kepala = (ti >= 0 ? arg.slice(0, ti) : arg).trim();
  const kebutuhan = [ti >= 0 ? arg.slice(ti + 1).trim() : "", lanjutan].filter(Boolean).join("\n").trim() || null;
  const ki = kepala.lastIndexOf(",");
  const facility = (ki >= 0 ? kepala.slice(0, ki) : kepala).trim();
  const city = ki >= 0 ? kepala.slice(ki + 1).trim() || null : null;
  if (!facility) return { ok: false, alasan: "kosong" };
  if ((kebutuhan ?? "").length > 2000) return { ok: false, alasan: "terlalu-panjang" };
  return { ok: true, facility_name: facility, city, kebutuhan };
}

export function contohLeads(): string {
  return "#LEADS RSUD dr Soedono, Madiun: butuh analyzer hematologi, pagu 2027";
}

// ── Routing ─────────────────────────────────────────────────────────────────

export interface HasilWilayah {
  am_id: string | null;
  am_nama: string | null;
  cabang: string | null;
  pic_hod: string | null;
  via: "wilayah" | "tak-terpetakan";
  catatan: string;
}

/** Kota → cabang lewat area_kota; null bila tak ada / lebih dari satu cabang. */
export async function cabangDariKota(city: string | null): Promise<string | null> {
  const k = normKota(city);
  if (!k) return null;
  // area_kota menyimpan 'KAB. NGAWI' / 'KOTA MALANG' — dinormalkan di TS
  // supaya aturan normKota satu definisi dengan master_territory.
  const ak = await db()<{ kota: string; cabang: string }[]>`SELECT kota, cabang FROM area_kota`;
  const c = [...new Set(ak.filter((r) => normKota(r.kota) === k).map((r) => String(r.cabang).trim().toUpperCase()))];
  return c.length === 1 ? c[0] : null;
}

/** Cabang → hod_key lewat hod_territory; null bila tak ada / ganda. */
export async function hodDariCabang(cabang: string): Promise<string | null> {
  const h = await db()`SELECT DISTINCT hod_key FROM hod_territory WHERE upper(btrim(cabang)) = ${cabang}`;
  return h.length === 1 ? String(h[0].hod_key) : null;
}

export async function resolveWilayah(city: string | null): Promise<HasilWilayah> {
  const sql = db();
  const kosong: HasilWilayah = { am_id: null, am_nama: null, cabang: null, pic_hod: null, via: "tak-terpetakan", catatan: "kota tidak diisi" };
  if (!city || !normKota(city)) return kosong;

  const terr = await sql<BarisTerritory[]>`SELECT am_panggilan, hod_panggilan, kota FROM master_territory`;
  const pilih = pilihAmWilayah(city, terr);
  let am_id: string | null = null;
  let am_nama: string | null = null;
  let cabang: string | null = null;
  let catatan = pilih === "ambigu" ? `kota ${city} dipegang lebih dari satu AM` : pilih ? "" : `kota ${city} belum ada di peta wilayah`;

  if (pilih && pilih !== "ambigu") {
    const [mu] = await sql`
      SELECT am_id, nama, NULLIF(btrim(cabang),'') AS cabang FROM master_user
      WHERE upper(btrim(panggilan)) = ${pilih.am_panggilan} AND aktif
      ORDER BY am_id LIMIT 2`;
    if (mu) {
      am_id = String(mu.am_id);
      am_nama = String(mu.nama ?? mu.am_id);
      cabang = mu.cabang ? String(mu.cabang).toUpperCase() : null;
    } else {
      catatan = `AM ${pilih.am_panggilan} di peta wilayah tak ditemukan/aktif di roster`;
    }
  }
  if (!cabang) cabang = await cabangDariKota(city);
  let pic_hod: string | null = cabang ? await hodDariCabang(cabang) : null;
  if (!pic_hod && pilih && pilih !== "ambigu" && pilih.hod_panggilan) pic_hod = pilih.hod_panggilan.trim().toLowerCase();
  return { am_id, am_nama, cabang, pic_hod, via: am_id ? "wilayah" : "tak-terpetakan", catatan };
}

// ── Duplikat ────────────────────────────────────────────────────────────────

export interface Duplikat { jenis: "lead" | "deal"; ref: string; nama: string; status: string; am_id: string | null }

/**
 * Lead/deal TERBUKA yang tampaknya faskes yang sama. Tidak memblokir — hanya
 * diberitahukan, karena satu faskes sah punya beberapa kebutuhan (hematologi
 * vs kimia klinik). Penyaringnya faskes_cocok (migrasi 176), sama dengan F95.
 */
export async function cariDuplikat(facility: string, exceptLeadId?: number): Promise<Duplikat[]> {
  const sql = db();
  const rows = await sql`
    SELECT 'lead' AS jenis, kode AS ref, facility_name AS nama, status, am_id
    FROM lead
    WHERE status IN ('baru','dihubungi') AND (${exceptLeadId ?? null}::bigint IS NULL OR id <> ${exceptLeadId ?? null}::bigint)
      AND (similarity(facility_name, ${facility}) >= 0.45 OR similarity(faskes_inti(facility_name), faskes_inti(${facility})) >= 0.5)
      AND faskes_cocok(${facility}, facility_name)
    UNION ALL
    SELECT 'deal', deal_id::text, COALESCE(facility_name, customer_name), stage::text, am_id
    FROM deal
    WHERE stage::text NOT IN ('Closing-Won','Closing-Lost')
      AND (similarity(COALESCE(facility_name, customer_name), ${facility}) >= 0.45
           OR similarity(faskes_inti(COALESCE(facility_name, customer_name)), faskes_inti(${facility})) >= 0.5)
      AND faskes_cocok(${facility}, COALESCE(facility_name, customer_name))
    LIMIT 5`;
  return rows.map((r) => ({ jenis: r.jenis as "lead" | "deal", ref: String(r.ref), nama: String(r.nama), status: String(r.status), am_id: r.am_id ? String(r.am_id) : null }));
}

// ── Tulis ───────────────────────────────────────────────────────────────────

export interface LeadInput {
  facility_name: string;
  city?: string | null;
  kebutuhan?: string | null;
  brand?: string | null;
  product?: string | null;
  product_category?: string | null;
  estimate_amount?: number | null;
  purchase_month?: number | null;
  purchase_year?: number | null;
  contact_name?: string | null;
  contact_role?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
  bant_budget?: boolean;
  bant_authority?: boolean;
  bant_need?: boolean;
  bant_timeline?: boolean;
  source: (typeof LEAD_SOURCES)[number];
  source_detail?: string | null;
  am_id?: string | null; // diisi bila pelapornya AM sendiri / admin menunjuk
}

export interface LeadRow {
  id: string; kode: string; facility_name: string; city: string | null; account_id: string | null;
  kebutuhan: string | null; brand: string | null; product: string | null; product_category: string | null;
  estimate_amount: number | null; purchase_month: number | null; purchase_year: number | null;
  contact_name: string | null; contact_role: string | null; contact_phone: string | null; notes: string | null;
  bant_budget: boolean; bant_authority: boolean; bant_need: boolean; bant_timeline: boolean; bant_skor: number;
  qualified: boolean; source: string; source_detail: string | null; status: string; alasan_tolak: string | null;
  am_id: string | null; am_nama: string | null; pic_hod: string | null; pic_hod_nama: string | null; cabang: string | null; routing_via: string;
  deal_id: string | null; converted_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  hari_kerja_baru: number | null; basi: "am" | "hod" | null;
}

// Hari kerja penuh sejak lead dibuat (tanggal WIB), tanpa Sabtu/Minggu & tanpa
// master_holiday. Hari pembuatan tak dihitung: lead masuk Senin sore → Kamis = 3.
const hariKerjaSql = (sql: ReturnType<typeof db>) => sql`(
  SELECT count(*)::int FROM generate_series(
      ((l.created_at AT TIME ZONE 'Asia/Jakarta')::date + 1),
      (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') d
  WHERE extract(isodow FROM d) < 6
    AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = d::date))`;

const selectLead = (sql: ReturnType<typeof db>) => sql`
  SELECT l.id::text, l.kode, l.facility_name, l.city, l.account_id::text, l.kebutuhan, l.brand, l.product,
         l.product_category, l.estimate_amount::float8, l.purchase_month, l.purchase_year,
         l.contact_name, l.contact_role, l.contact_phone, l.notes,
         l.bant_budget, l.bant_authority, l.bant_need, l.bant_timeline, l.bant_skor,
         l.source, l.source_detail, l.status, l.alasan_tolak,
         l.am_id, NULLIF(mu.nama,'') AS am_nama, l.pic_hod, NULLIF(mh.nama,'') AS pic_hod_nama, l.cabang, l.routing_via,
         l.deal_id::text, l.converted_at::text, l.created_by, l.created_at::text, l.updated_at::text,
         CASE WHEN l.status = 'baru' THEN ${hariKerjaSql(sql)} END AS hari_kerja_baru
  FROM lead l LEFT JOIN master_user mu ON mu.am_id = l.am_id
  LEFT JOIN master_hod mh ON mh.hod_key = l.pic_hod`;

function toRow(r: Record<string, unknown>): LeadRow {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  const hari = n(r.hari_kerja_baru);
  const tanpaAm = r.am_id == null;
  const basi = hari == null ? null : hari >= AGING_HARI_HOD || (tanpaAm && hari >= AGING_HARI_AM) ? "hod" : hari >= AGING_HARI_AM ? "am" : null;
  return {
    id: String(r.id), kode: String(r.kode), facility_name: String(r.facility_name), city: s(r.city), account_id: s(r.account_id),
    kebutuhan: s(r.kebutuhan), brand: s(r.brand), product: s(r.product), product_category: s(r.product_category),
    estimate_amount: n(r.estimate_amount), purchase_month: n(r.purchase_month), purchase_year: n(r.purchase_year),
    contact_name: s(r.contact_name), contact_role: s(r.contact_role), contact_phone: s(r.contact_phone), notes: s(r.notes),
    bant_budget: Boolean(r.bant_budget), bant_authority: Boolean(r.bant_authority), bant_need: Boolean(r.bant_need), bant_timeline: Boolean(r.bant_timeline),
    bant_skor: Number(r.bant_skor), qualified: Number(r.bant_skor) >= BANT_LOLOS,
    source: String(r.source), source_detail: s(r.source_detail), status: String(r.status), alasan_tolak: s(r.alasan_tolak),
    am_id: s(r.am_id), am_nama: s(r.am_nama), pic_hod: s(r.pic_hod), pic_hod_nama: s(r.pic_hod_nama), cabang: s(r.cabang), routing_via: String(r.routing_via),
    deal_id: s(r.deal_id), converted_at: s(r.converted_at), created_by: s(r.created_by),
    created_at: String(r.created_at), updated_at: String(r.updated_at),
    hari_kerja_baru: hari, basi,
  };
}

function bersih(v: unknown, maks = 500): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, maks) : null;
}

/**
 * Buat lead. Routing: bila `am_id` diberikan (pelapor AM / penunjukan admin)
 * itu yang dipakai dan cabangnya ikut AM; selain itu resolveWilayah(city).
 * Faskes dicocokkan ke master Accurate — kalau tepat satu, account_id terisi
 * (lead dari pelanggan lama). Ambigu/tak ketemu = dibiarkan kosong, bukan error:
 * kebanyakan lead justru faskes yang BELUM pernah beli.
 */
export async function buatLead(
  input: LeadInput,
  meta: { created_by: string | null; group_jid?: string | null; wa_message_id?: string | null; via_pengirim?: boolean },
): Promise<{ lead: LeadRow; baru: boolean; duplikat: Duplikat[]; wilayah: HasilWilayah | null }> {
  const sql = db();
  const facility = bersih(input.facility_name, 200);
  if (!facility) throw new LeadError(400, "nama faskes wajib diisi");
  if (!LEAD_SOURCES.includes(input.source)) throw new LeadError(400, `sumber harus salah satu: ${LEAD_SOURCES.join(", ")}`);
  if (input.product_category && !["IVD", "Medical"].includes(input.product_category)) throw new LeadError(400, "kategori produk harus IVD atau Medical");

  if (meta.wa_message_id) {
    const [ada] = await sql`SELECT id FROM lead WHERE wa_message_id = ${meta.wa_message_id}`;
    if (ada) {
      const [r] = await sql`${selectLead(sql)} WHERE l.id = ${ada.id}`;
      return { lead: toRow(r), baru: false, duplikat: [], wilayah: null };
    }
  }

  let am_id: string | null = bersih(input.am_id, 64);
  let cabang: string | null = null;
  let pic_hod: string | null = null;
  let routing_via: "wilayah" | "pengirim" | "manual" | "tak-terpetakan" = "manual";
  let wilayah: HasilWilayah | null = null;
  if (am_id) {
    const [mu] = await sql`SELECT NULLIF(btrim(cabang),'') AS cabang FROM master_user WHERE am_id = ${am_id}`;
    if (!mu) throw new LeadError(400, `AM ${am_id} tidak ada di roster`);
    // AM tanpa cabang di roster (2 dari 16 AM aktif di dev, uji Research
    // 13 Okt): pakai kota lead supaya HoD-nya tetap melihat lead ini —
    // tanpa cabang, lead hanya terlihat oleh AM itu sendiri dan admin.
    cabang = mu.cabang ? String(mu.cabang).toUpperCase() : await cabangDariKota(bersih(input.city, 100));
    if (cabang) pic_hod = await hodDariCabang(cabang);
    routing_via = meta.via_pengirim ? "pengirim" : "manual";
  } else {
    wilayah = await resolveWilayah(bersih(input.city, 100));
    am_id = wilayah.am_id;
    cabang = wilayah.cabang;
    pic_hod = wilayah.pic_hod;
    routing_via = wilayah.via;
  }

  let account_id: number | null = null;
  try {
    const akun = await cariAkun(facility);
    if (akun.kind === "one" && akun.ids.length) account_id = akun.ids[0];
  } catch (e) {
    console.error("[lead] cari akun gagal (non-fatal):", (e as Error).message);
  }

  const duplikat = await cariDuplikat(facility);
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const [r] = await sql`
    INSERT INTO lead (facility_name, city, account_id, kebutuhan, brand, product, product_category, estimate_amount,
                      purchase_month, purchase_year, contact_name, contact_role, contact_phone, notes,
                      bant_budget, bant_authority, bant_need, bant_timeline, source, source_detail,
                      am_id, pic_hod, cabang, routing_via, created_by, group_jid, wa_message_id)
    VALUES (${facility}, ${bersih(input.city, 100)}, ${account_id}, ${bersih(input.kebutuhan, 2000)}, ${bersih(input.brand, 100)},
            ${bersih(input.product, 200)}, ${input.product_category ?? null}, ${num(input.estimate_amount)},
            ${num(input.purchase_month)}, ${num(input.purchase_year)}, ${bersih(input.contact_name, 120)},
            ${bersih(input.contact_role, 120)}, ${bersih(input.contact_phone, 40)}, ${bersih(input.notes, 2000)},
            ${Boolean(input.bant_budget)}, ${Boolean(input.bant_authority)}, ${Boolean(input.bant_need)}, ${Boolean(input.bant_timeline)},
            ${input.source}, ${bersih(input.source_detail, 200)}, ${am_id}, ${pic_hod}, ${cabang}, ${routing_via},
            ${meta.created_by}, ${meta.group_jid ?? null}, ${meta.wa_message_id ?? null})
    ON CONFLICT (wa_message_id) DO NOTHING
    RETURNING id`;
  if (!r) {
    // balapan dua proses atas pesan WA yang sama
    const [lama] = await sql`${selectLead(sql)} WHERE l.wa_message_id = ${meta.wa_message_id ?? null}`;
    return { lead: toRow(lama), baru: false, duplikat: [], wilayah };
  }
  const [row] = await sql`${selectLead(sql)} WHERE l.id = ${r.id}`;
  return { lead: toRow(row), baru: true, duplikat, wilayah };
}

// ── Baca (ber-scope) ────────────────────────────────────────────────────────

export interface LeadFilter { status?: string | null; am_id?: string | null; source?: string | null; basi?: boolean; q?: string | null }

export async function listLeads(scope: DataScope, f: LeadFilter = {}): Promise<LeadRow[]> {
  const sql = db();
  const rows = await sql`
    ${selectLead(sql)}
    WHERE true
      ${scopeOnClause(sql, scope, sql`l.am_id`, sql`l.cabang`)}
      ${f.status ? sql`AND l.status = ${f.status}` : sql``}
      ${f.am_id ? sql`AND l.am_id = ${f.am_id}` : sql``}
      ${f.source ? sql`AND l.source = ${f.source}` : sql``}
      ${f.q ? sql`AND (l.facility_name ILIKE ${"%" + f.q.replace(/[\\%_]/g, (m) => "\\" + m) + "%"} OR l.kode ILIKE ${f.q})` : sql``}
    ORDER BY CASE l.status WHEN 'baru' THEN 0 WHEN 'dihubungi' THEN 1 ELSE 2 END, l.created_at DESC
    LIMIT 500`;
  const out = rows.map(toRow);
  return f.basi ? out.filter((r) => r.basi) : out;
}

export async function getLead(scope: DataScope, id: string): Promise<LeadRow | null> {
  const sql = db();
  if (!/^\d+$/.test(id)) return null;
  const [r] = await sql`${selectLead(sql)} WHERE l.id = ${id} ${scopeOnClause(sql, scope, sql`l.am_id`, sql`l.cabang`)}`;
  return r ? toRow(r) : null;
}

// ── Ubah ────────────────────────────────────────────────────────────────────

const EDITABLE = [
  "facility_name", "city", "kebutuhan", "brand", "product", "product_category", "estimate_amount",
  "purchase_month", "purchase_year", "contact_name", "contact_role", "contact_phone", "notes",
  "bant_budget", "bant_authority", "bant_need", "bant_timeline", "source_detail",
] as const;

/**
 * Ubah isi lead + status 'baru'↔'dihubungi'/'ditolak' + penunjukan AM.
 * Konversi TIDAK lewat sini (konversiLead). Menunjuk AM hanya untuk HoD/admin,
 * dan HoD hanya ke AM di cabang timnya — sama dengan aturan pemilik Accounts.
 */
export async function updateLead(scope: DataScope, id: string, input: Record<string, unknown>): Promise<LeadRow> {
  const sql = db();
  const lama = await getLead(scope, id);
  if (!lama) throw new LeadError(404, "lead tak ditemukan");
  if (lama.status === "dikonversi") throw new LeadError(409, `lead ${lama.kode} sudah dikonversi jadi deal — ubah di Pipeline`);

  const set: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (!(k in input)) continue;
    const v = input[k];
    if (k.startsWith("bant_")) set[k] = Boolean(v);
    else if (["estimate_amount", "purchase_month", "purchase_year"].includes(k)) set[k] = v == null || v === "" ? null : Number(v);
    else set[k] = bersih(v, k === "kebutuhan" || k === "notes" ? 2000 : 200);
  }
  if ("facility_name" in set && !set.facility_name) throw new LeadError(400, "nama faskes wajib diisi");
  if (set.product_category && !["IVD", "Medical"].includes(String(set.product_category))) throw new LeadError(400, "kategori produk harus IVD atau Medical");
  if (set.purchase_month != null && !(Number(set.purchase_month) >= 1 && Number(set.purchase_month) <= 12)) throw new LeadError(400, "bulan beli 1–12");

  if ("status" in input) {
    const st = String(input.status);
    if (!["baru", "dihubungi", "ditolak"].includes(st)) throw new LeadError(400, "status hanya boleh baru / dihubungi / ditolak (konversi lewat tombol Konversi)");
    if (st === "ditolak" && !bersih(input.alasan_tolak)) throw new LeadError(400, "alasan menolak lead wajib diisi");
    set.status = st;
    set.alasan_tolak = st === "ditolak" ? bersih(input.alasan_tolak) : null;
  }

  if ("am_id" in input) {
    if (scope.amOnly) throw new LeadError(403, "AM tidak bisa memindahkan lead");
    const am = bersih(input.am_id, 64);
    if (am) {
      const [mu] = await sql`SELECT am_id, NULLIF(btrim(cabang),'') AS cabang, aktif FROM master_user WHERE am_id = ${am}`;
      if (!mu || !mu.aktif) throw new LeadError(400, `AM ${am} tidak ada / nonaktif di roster`);
      const cab = mu.cabang ? String(mu.cabang).toUpperCase() : null;
      if (scope.cabangScope?.length && !(cab && scope.cabangScope.includes(cab))) throw new LeadError(403, "AM tujuan di luar cabang tim Anda");
      set.am_id = am;
      // AM tanpa cabang di roster → cabang lead yang lama dipertahankan; kalau
      // ikut dikosongkan, lead lenyap dari pandangan HoD-nya.
      set.cabang = cab ?? lama.cabang;
      if (cab) set.pic_hod = (await hodDariCabang(cab)) ?? lama.pic_hod;
    } else {
      set.am_id = null;
    }
    set.routing_via = "manual";
    // penunjukan baru = jam aging AM mulai lagi dari pengingat yang belum terkirim
    set.reminder_am_at = null;
  }

  if (Object.keys(set).length === 0) return lama;
  set.updated_at = sql`now()`;
  await sql`UPDATE lead SET ${sql(set)} WHERE id = ${id}`;
  const baru = await getLead(scope, id);
  if (!baru) throw new LeadError(404, "lead tak ditemukan");
  return baru;
}

/**
 * Konversi lead → deal Prospecting (createDeal). Syarat: BANT ≥ 3, sudah ber-AM,
 * belum dikonversi/ditolak. Dua konversi bersamaan dicegah dengan mengunci
 * baris lead (FOR UPDATE) selama deal dibuat. createDeal memakai koneksinya
 * sendiri (di luar transaksi ini), jadi kalau langkah sesudahnya gagal, deal
 * yang sudah terbuat DIHAPUS lagi — tak boleh ada deal yatim tanpa lead.
 */
export async function konversiLead(scope: DataScope, id: string, oleh: string | null): Promise<{ lead: LeadRow; deal_id: string }> {
  const sql = db();
  const l = await getLead(scope, id);
  if (!l) throw new LeadError(404, "lead tak ditemukan");
  if (l.status === "dikonversi") throw new LeadError(409, `lead ${l.kode} sudah dikonversi`);
  if (l.status === "ditolak") throw new LeadError(409, `lead ${l.kode} sudah ditolak — buka lagi (status baru) dulu kalau mau dikonversi`);
  if (l.bant_skor < BANT_LOLOS) throw new LeadError(400, `BANT baru ${l.bant_skor}/4 — minimal ${BANT_LOLOS} untuk dikonversi jadi deal`);
  if (!l.am_id) throw new LeadError(400, "tunjuk AM-nya dulu sebelum dikonversi");

  return await sql.begin(async (tx) => {
    const [cur] = await tx`SELECT status, deal_id FROM lead WHERE id = ${id} FOR UPDATE`;
    if (!cur || cur.deal_id || !["baru", "dihubungi"].includes(String(cur.status))) {
      throw new LeadError(409, `lead ${l.kode} sudah diproses orang lain`);
    }
    const notes = [
      `Dari lead ${l.kode} (${l.source}${l.source_detail ? ": " + l.source_detail : ""})`,
      l.kebutuhan ? `Kebutuhan: ${l.kebutuhan}` : null,
      l.contact_name ? `Kontak: ${[l.contact_name, l.contact_role, l.contact_phone].filter(Boolean).join(" · ")}` : null,
      l.notes,
    ].filter(Boolean).join("\n");
    // amOnly dimatikan: akses ke lead SUDAH dicek getLead(scope); deal harus
    // atas nama AM pemilik lead, bukan atas nama yang menekan tombol.
    const d = await createDeal({ ...scope, amOnly: false }, {
      facility_name: l.facility_name, customer_name: l.facility_name, am_id: l.am_id, city: l.city,
      brand: l.brand, product: l.product, product_category: l.product_category, estimate_amount: l.estimate_amount,
      purchase_month: l.purchase_month, purchase_year: l.purchase_year, cabang: l.cabang, pic_hod: l.pic_hod, notes,
    });
    try {
      if (l.account_id) await tx`UPDATE deal SET account_id = ${l.account_id} WHERE deal_id = ${d.deal_id}`;
      await tx`
        UPDATE spt_state_log SET reason = ${"deal dibuat dari lead " + l.kode}, changed_by = COALESCE(${oleh}, changed_by)
        WHERE deal_id = ${d.deal_id} AND from_stage IS NULL`;
      await tx`UPDATE lead SET status = 'dikonversi', deal_id = ${d.deal_id}, converted_at = now(), updated_at = now() WHERE id = ${id}`;
    } catch (e) {
      await sql`DELETE FROM spt_state_log WHERE deal_id = ${d.deal_id}`;
      await sql`DELETE FROM deal WHERE deal_id = ${d.deal_id}`;
      throw e;
    }
    return { deal_id: d.deal_id };
  }).then(async ({ deal_id }) => {
    const baru = await getLead(scope, id);
    if (!baru) throw new LeadError(404, "lead tak ditemukan");
    return { lead: baru, deal_id };
  });
}

// ── Aging (job lead-aging) ──────────────────────────────────────────────────

/** Ringkasan satu orang: daftar lead yang belum dihubungi. Fungsi murni (diuji). */
export function pesanAging(peran: "am" | "hod", nama: string, leads: { kode: string; facility_name: string; city: string | null; hari: number; am_nama: string | null }[]): string {
  const judul = peran === "am"
    ? `⏰ *Lead belum dihubungi* — ${nama}, ${leads.length} lead sudah ${AGING_HARI_AM}+ hari kerja berstatus BARU:`
    : `⏰ *Lead tim belum ditindaklanjuti* — ${nama}, ${leads.length} lead sudah lewat batas:`;
  const baris = leads.slice(0, 15).map((l) =>
    `• ${l.kode} ${l.facility_name}${l.city ? ` (${l.city})` : ""} — ${l.hari} hari kerja${peran === "hod" ? ` · ${l.am_nama ?? "BELUM ADA AM"}` : ""}`);
  const lebih = leads.length > 15 ? [`…dan ${leads.length - 15} lead lain`] : [];
  const ajakan = peran === "am"
    ? "Hubungi faskesnya lalu ubah status jadi *Dihubungi* (atau *Ditolak* dengan alasan) di menu Leads."
    : "Cek di menu Leads — tunjuk AM untuk lead yang belum ber-AM.";
  return [judul, ...baris, ...lebih, "", ajakan].join("\n");
}

/**
 * Pengingat lead berstatus 'baru' (belum dihubungi):
 *   AM  — lead miliknya ≥ AGING_HARI_AM hari kerja, sekali per lead (reminder_am_at);
 *   HoD — lead cabang timnya ≥ AGING_HARI_HOD hari kerja, ATAU lead tanpa AM
 *         ≥ AGING_HARI_AM (tak ada AM yang bisa diingatkan), sekali per lead.
 * Satu pesan ringkasan per orang. Penanda HANYA ditulis bila WA benar-benar
 * terkirim live (bukan stub/dry-run) — pola F38/F45/F139/LPSE.
 * Penerima tanpa nomor WA dilewati diam-diam (anti-broadcast salah sasaran).
 */
export async function runLeadAging(): Promise<{ am: number; hod: number; lewati: string[] }> {
  const sql = db();
  const rows = await sql`
    SELECT l.id, l.kode, l.facility_name, l.city, l.am_id, l.pic_hod, l.reminder_am_at, l.reminder_hod_at,
           NULLIF(mu.nama,'') AS am_nama, NULLIF(btrim(mu.wa_number),'') AS am_wa,
           ${hariKerjaSql(sql)} AS hari
    FROM lead l LEFT JOIN master_user mu ON mu.am_id = l.am_id
    WHERE l.status = 'baru'`;
  type R = { id: number; kode: string; facility_name: string; city: string | null; am_id: string | null; pic_hod: string | null; am_nama: string | null; am_wa: string | null; hari: number; reminder_am_at: unknown; reminder_hod_at: unknown };
  const all = rows as unknown as R[];
  const lewati: string[] = [];
  let am = 0;
  let hod = 0;

  const perAm = new Map<string, R[]>();
  for (const r of all) {
    if (r.am_id && r.reminder_am_at == null && Number(r.hari) >= AGING_HARI_AM) {
      perAm.set(r.am_id, [...(perAm.get(r.am_id) ?? []), r]);
    }
  }
  for (const [amId, ls] of perAm) {
    const wa = ls[0].am_wa;
    if (!wa) { lewati.push(`AM ${amId}: nomor WA kosong`); continue; }
    const gw = await sendViaWaGateway(wa, pesanAging("am", ls[0].am_nama ?? amId, ls.map((l) => ({ ...l, hari: Number(l.hari) }))));
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await sql`UPDATE lead SET reminder_am_at = now() WHERE id = ANY(${ls.map((l) => l.id)}::bigint[])`;
      am += 1;
    }
  }

  const perHod = new Map<string, R[]>();
  for (const r of all) {
    const lewat = Number(r.hari) >= AGING_HARI_HOD || (!r.am_id && Number(r.hari) >= AGING_HARI_AM);
    if (r.pic_hod && r.reminder_hod_at == null && lewat) perHod.set(r.pic_hod, [...(perHod.get(r.pic_hod) ?? []), r]);
    else if (!r.pic_hod && r.reminder_hod_at == null && lewat) lewati.push(`${r.kode}: belum ber-HoD (cabang tak terpetakan)`);
  }
  for (const [hodKey, ls] of perHod) {
    const [u] = await sql`
      SELECT name, wa_number FROM app_user
      WHERE hod_key = ${hodKey} AND active = true AND wa_number IS NOT NULL AND wa_number <> ''
      ORDER BY created_at LIMIT 1`;
    if (!u) { lewati.push(`HoD ${hodKey}: belum ada akun ber-nomor WA`); continue; }
    const gw = await sendViaWaGateway(String(u.wa_number), pesanAging("hod", String(u.name ?? hodKey), ls.map((l) => ({ ...l, hari: Number(l.hari) }))));
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await sql`UPDATE lead SET reminder_hod_at = now() WHERE id = ANY(${ls.map((l) => l.id)}::bigint[])`;
      hod += 1;
    }
  }
  return { am, hod, lewati };
}

// ── Balasan WA #LEADS (murni, diuji) ────────────────────────────────────────

export function balasanLeadTercatat(x: {
  lead: Pick<LeadRow, "kode" | "facility_name" | "city" | "am_nama" | "am_id" | "pic_hod" | "routing_via" | "account_id"> & { pic_hod_nama?: string | null };
  pengirim: string;
  duplikat: Duplikat[];
  catatanWilayah?: string | null;
}): string {
  const l = x.lead;
  const ke = l.am_id
    ? `diteruskan ke AM *${l.am_nama ?? l.am_id}*${l.routing_via === "pengirim" ? " (Anda sendiri)" : ""}`
    : l.pic_hod
      ? `BELUM ber-AM — HoD *${l.pic_hod_nama ?? l.pic_hod}* akan menunjuk AM-nya`
      : "BELUM ber-AM — admin akan menunjuk AM-nya";
  const baris = [
    `✅ Lead *${l.kode}* tercatat: ${l.facility_name}${l.city ? ` (${l.city})` : ""}, ${x.pengirim}.`,
    `→ ${ke}.`,
    !l.am_id && x.catatanWilayah ? `   (${x.catatanWilayah})` : null,
    l.account_id ? "ℹ️ Faskes ini sudah pelanggan di Accurate." : null,
  ];
  if (x.duplikat.length) {
    baris.push("", "⚠️ Mirip yang masih terbuka:");
    for (const d of x.duplikat.slice(0, 3)) {
      baris.push(`• ${d.jenis === "lead" ? `lead ${d.ref}` : "deal di Pipeline"} — ${d.nama} (${d.status})`);
    }
    baris.push("Kalau ternyata sama, tolak lead ini di menu Leads dengan alasan duplikat.");
  }
  baris.push("", "Lengkapi BANT (budget, pengambil keputusan, kebutuhan, waktu beli) di menu Leads — minimal 3 dari 4 untuk dikonversi jadi deal.");
  return baris.filter((b) => b !== null).join("\n");
}

// ── Masukan dari web (form menu Leads) ──────────────────────────────────────

/** Validasi penunjukan AM sesuai scope, lalu buatLead. Dipanggil route POST /leads. */
export async function buatLeadWeb(scope: DataScope, body: Record<string, unknown>, oleh: string | null) {
  const sql = db();
  const src = String(body.source ?? "web");
  if (!(LEAD_SOURCES as readonly string[]).includes(src)) throw new LeadError(400, `sumber harus salah satu: ${LEAD_SOURCES.join(", ")}`);
  let am_id: string | null = null;
  let via_pengirim = false;
  if (scope.amOnly && scope.amId) {
    am_id = scope.amId; // AM selalu mencatat atas namanya sendiri
    via_pengirim = true;
  } else if (typeof body.am_id === "string" && body.am_id.trim()) {
    am_id = body.am_id.trim();
    const [mu] = await sql`SELECT NULLIF(btrim(cabang),'') AS cabang, aktif FROM master_user WHERE am_id = ${am_id}`;
    if (!mu || !mu.aktif) throw new LeadError(400, `AM ${am_id} tidak ada / nonaktif di roster`);
    const cab = mu.cabang ? String(mu.cabang).toUpperCase() : null;
    if (scope.cabangScope?.length && !(cab && scope.cabangScope.includes(cab))) throw new LeadError(403, "AM tujuan di luar cabang tim Anda");
  }
  const input: LeadInput = {
    facility_name: String(body.facility_name ?? ""),
    city: body.city as string | null, kebutuhan: body.kebutuhan as string | null,
    brand: body.brand as string | null, product: body.product as string | null,
    product_category: (body.product_category as string | null) || null,
    estimate_amount: body.estimate_amount as number | null,
    purchase_month: body.purchase_month as number | null, purchase_year: body.purchase_year as number | null,
    contact_name: body.contact_name as string | null, contact_role: body.contact_role as string | null,
    contact_phone: body.contact_phone as string | null, notes: body.notes as string | null,
    bant_budget: Boolean(body.bant_budget), bant_authority: Boolean(body.bant_authority),
    bant_need: Boolean(body.bant_need), bant_timeline: Boolean(body.bant_timeline),
    source: src as LeadInput["source"], source_detail: body.source_detail as string | null, am_id,
  };
  const hasil = await buatLead(input, { created_by: oleh, via_pengirim });
  // Lead yang dibuat HoD tapi ter-routing ke cabang LAIN tak akan terlihat
  // olehnya lagi — beri tahu, jangan diam-diam "hilang" dari daftar.
  const terlihat = await getLead(scope, hasil.lead.id);
  return { ...hasil, terlihat: Boolean(terlihat) };
}
