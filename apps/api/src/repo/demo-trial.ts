// F18 Trial/Demo Outcome Logger — migrasi 210.
//
// Keputusan user 2026-10-13: demo (sekali datang) & trial (alat dipinjamkan,
// punya tanggal selesai) DIBEDAKAN; hasil DINILAI AM saat menutup
// (positif/netral/negatif + alasan); dicatat dari WA, kartu deal Pipeline, dan
// menu Demo & Trial. Konversi per produk = positif ÷ yang sudah ditutup.
//
// Tak ikut KPI: kunjungan demo sudah dihitung #REPORT tipe Demo; tabel ini
// mencatat HASIL-nya. account_id opsional — demo sering ke calon pelanggan.
// Scope baris sama dengan Leads: AM = miliknya, HoD = cabang timnya, admin semua.

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { scopeOnClause, type DataScope } from "./access-scope.js";
import { cariAkun } from "./interaction.js";
import { sendViaWaGateway } from "../wasend.js";

export type JenisDT = "demo" | "trial";
export type HasilDT = "positif" | "netral" | "negatif";
export const HASIL: HasilDT[] = ["positif", "netral", "negatif"];
export const TRIAL_HARI_DEFAULT = 14;

export class DemoTrialError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Parser WA (murni, diuji) ────────────────────────────────────────────────

const LINE: Record<JenisDT, RegExp> = { demo: /^\s*#\s*demo\b/i, trial: /^\s*#\s*trial\b/i };
const KODE = /^(DM|TR)-\d{1,6}$/i;

export type ParseDT =
  | { ok: true; mode: "buka"; facility: string; alat: string; hari: number | null; sampai: string | null; catatan: string | null }
  | { ok: true; mode: "tutup"; kode: string; hasil: HasilDT; alasan: string | null }
  | { ok: false; alasan: "kosong" | "tanpa-alat" | "hasil-salah" | "tanggal-salah" | "tanggal-lewat" };

/** 'dd/mm', 'dd/mm/yyyy', 'dd-mm-yyyy' → ISO (tahun default = tahun `hariIni`). */
export function parseTanggal(s: string, hariIni: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : Number(hariIni.slice(0, 4));
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/**
 * Buka:  #DEMO <faskes>: <alat>[; catatan]
 *        #TRIAL <faskes>: <alat>, <N> hari[; catatan]   |   …, sampai <dd/mm>[; catatan]
 * Tutup: #DEMO DM-0001 positif[: alasan]   (#TRIAL TR-0003 negatif: kalah harga)
 * Pemisah faskes–alat WAJIB titik dua (pola #CALL): tanpa itu batas nama tak bisa ditebak.
 */
export function parseDemoTrial(body: string | null, jenis: JenisDT, hariIni: string): ParseDT {
  if (!body) return { ok: false, alasan: "kosong" };
  const lines = stripInvisible(body).split(/\r?\n/);
  const idx = lines.findIndex((l) => LINE[jenis].test(l));
  if (idx < 0) return { ok: false, alasan: "kosong" };
  const arg = lines[idx].replace(LINE[jenis], "").trim();
  const lanjutan = lines.slice(idx + 1).join("\n").trim();
  if (!arg) return { ok: false, alasan: "kosong" };

  const tok = arg.split(/\s+/);
  if (KODE.test(tok[0])) {
    const sisa = arg.slice(tok[0].length).trim();
    const m = sisa.match(/^(positif|netral|negatif)\b\s*:?\s*([\s\S]*)$/i);
    if (!m) return { ok: false, alasan: "hasil-salah" };
    const alasan = [m[2].trim(), lanjutan].filter(Boolean).join("\n") || null;
    return { ok: true, mode: "tutup", kode: tok[0].toUpperCase(), hasil: m[1].toLowerCase() as HasilDT, alasan };
  }

  const ti = arg.indexOf(":");
  if (ti < 0) return { ok: false, alasan: "tanpa-alat" };
  const facility = arg.slice(0, ti).trim();
  let rest = arg.slice(ti + 1).trim();
  if (!facility) return { ok: false, alasan: "kosong" };
  let catatan: string | null = null;
  const si = rest.indexOf(";");
  if (si >= 0) { catatan = rest.slice(si + 1).trim() || null; rest = rest.slice(0, si).trim(); }
  catatan = [catatan, lanjutan].filter(Boolean).join("\n") || null;

  let hari: number | null = null;
  let sampai: string | null = null;
  if (jenis === "trial") {
    const mh = rest.match(/,\s*(\d{1,3})\s*hari\s*$/i);
    const ms = rest.match(/,\s*(?:sampai|s\/d|sd)\s+(\S+)\s*$/i);
    if (mh) { hari = Number(mh[1]); rest = rest.slice(0, mh.index).trim(); }
    else if (ms) {
      sampai = parseTanggal(ms[1], hariIni);
      if (!sampai) return { ok: false, alasan: "tanggal-salah" };
      // Trial dari WA selalu mulai hari ini — tanggal selesai yang sudah lewat
      // pasti salah ketik (uji Research 13 Okt: "sampai 3/10" pada 13 Okt).
      if (sampai < hariIni) return { ok: false, alasan: "tanggal-lewat" };
      rest = rest.slice(0, ms.index).trim();
    }
  }
  // Tanda baca di ujung ("Zybio EXC810," — durasi lupa ditulis) dibuang.
  rest = rest.replace(/[\s,;:.-]+$/, "").trim();
  if (!rest) return { ok: false, alasan: "tanpa-alat" };
  return { ok: true, mode: "buka", facility, alat: rest, hari, sampai, catatan };
}

const TAG: Record<JenisDT, string> = { demo: "#DEMO", trial: "#TRIAL" };
export function contohDT(jenis: JenisDT): string {
  return jenis === "demo"
    ? "#DEMO RSUD dr Soedono: Zybio Z3 hematologi"
    : "#TRIAL RSUD dr Soedono: Zybio EXC810, 14 hari";
}

export function balasanFormatDT(jenis: JenisDT, alasan: "kosong" | "tanpa-alat" | "hasil-salah" | "tanggal-salah" | "tanggal-lewat", nama: string): string {
  if (alasan === "hasil-salah") {
    return `⚠️ Hasil belum terbaca, ${nama}. Tulis positif / netral / negatif sesudah kodenya.\nContoh: ${TAG[jenis]} ${jenis === "demo" ? "DM" : "TR"}-0001 positif: kepala lab minta penawaran`;
  }
  if (alasan === "tanggal-lewat") return `⚠️ Tanggal selesai trial sudah lewat, ${nama} — trial dari WhatsApp dihitung mulai hari ini. Tulis tanggal ke depan (mis. "sampai 31/10") atau lama hari (mis. "14 hari"). ${TAG[jenis]} BELUM dicatat.`;
  if (alasan === "tanggal-salah") return `⚠️ Tanggal selesai trial tidak terbaca, ${nama}. Pakai format hari/bulan, mis. "sampai 31/10", atau "14 hari".`;
  return `⚠️ ${TAG[jenis]} belum tercatat, ${nama}: ${alasan === "tanpa-alat" ? "pisahkan nama faskes dan alatnya dengan titik dua" : "nama faskes dan alatnya belum ada"}.\nContoh: ${contohDT(jenis)}`;
}

// ── Tulis ───────────────────────────────────────────────────────────────────

export interface DemoTrialRow {
  id: string; jenis: JenisDT; kode: string; facility_name: string; account_id: string | null; deal_id: string | null;
  deal_stage: string | null; alat: string; brand: string | null; tanggal: string; tanggal_selesai: string | null;
  catatan: string | null; hasil: HasilDT | null; alasan_hasil: string | null; ditutup_at: string | null; ditutup_oleh: string | null;
  am_id: string | null; am_nama: string | null; cabang: string | null; source: string; created_by: string | null; created_at: string;
  lewat_selesai: boolean;
}

const selectDT = (sql: ReturnType<typeof db>) => sql`
  SELECT t.id::text, t.jenis, t.kode, t.facility_name, t.account_id::text, t.deal_id::text, d.stage::text AS deal_stage,
         t.alat, t.brand, t.tanggal::text, t.tanggal_selesai::text, t.catatan, t.hasil, t.alasan_hasil,
         t.ditutup_at::text, t.ditutup_oleh, t.am_id, NULLIF(mu.nama,'') AS am_nama, t.cabang, t.source,
         t.created_by, t.created_at::text,
         (t.hasil IS NULL AND t.tanggal_selesai IS NOT NULL
          AND t.tanggal_selesai < (now() AT TIME ZONE 'Asia/Jakarta')::date) AS lewat_selesai
  FROM demo_trial t
  LEFT JOIN master_user mu ON mu.am_id = t.am_id
  LEFT JOIN deal d ON d.deal_id = t.deal_id`;

function toRow(r: Record<string, unknown>): DemoTrialRow {
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    id: String(r.id), jenis: r.jenis as JenisDT, kode: String(r.kode), facility_name: String(r.facility_name),
    account_id: s(r.account_id), deal_id: s(r.deal_id), deal_stage: s(r.deal_stage), alat: String(r.alat), brand: s(r.brand),
    tanggal: String(r.tanggal), tanggal_selesai: s(r.tanggal_selesai), catatan: s(r.catatan),
    hasil: (s(r.hasil) as HasilDT | null), alasan_hasil: s(r.alasan_hasil), ditutup_at: s(r.ditutup_at), ditutup_oleh: s(r.ditutup_oleh),
    am_id: s(r.am_id), am_nama: s(r.am_nama), cabang: s(r.cabang), source: String(r.source), created_by: s(r.created_by),
    created_at: String(r.created_at), lewat_selesai: Boolean(r.lewat_selesai),
  };
}

const wibHariIni = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const tambahHari = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function bersih(v: unknown, maks = 500): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, maks) : null;
}

/**
 * Deal terbuka yang paling mungkin dimaksud: faskes sama (account_id, atau
 * nama lolos faskes_cocok) DAN brand deal tersebut muncul di teks alat. Hanya
 * kalau TEPAT SATU — selebihnya dibiarkan kosong, ditautkan manual dari Pipeline.
 */
export async function tebakDeal(facility: string, accountId: number | null, alat: string): Promise<string | null> {
  const sql = db();
  const rows = await sql`
    SELECT deal_id::text, brand FROM deal
    WHERE stage::text NOT IN ('Closing-Won','Closing-Lost')
      AND (${accountId}::bigint IS NOT NULL AND account_id = ${accountId}::bigint
           OR (similarity(COALESCE(facility_name, customer_name), ${facility}) >= 0.45
               AND faskes_cocok(${facility}, COALESCE(facility_name, customer_name))))
      AND NULLIF(btrim(brand),'') IS NOT NULL
      AND position(lower(btrim(brand)) in lower(${alat})) > 0
    LIMIT 2`;
  return rows.length === 1 ? String(rows[0].deal_id) : null;
}

/**
 * Brand untuk rekap konversi per produk. Tanpa ini demo dari WA ("Zybio Z3
 * hematologi", brand kosong) dan dari web (brand "Zybio") jatuh ke dua baris
 * rekap berbeda. Urutan: isian pengguna (dinormalkan norm_brand, migrasi 108)
 * → brand deal tertaut → kata pertama alat bila dikenal sebagai brand
 * (brand_alias, atau brand yang sudah dipakai di deal). Tak ketemu = NULL.
 */
export async function tebakBrand(brand: string | null, dealId: string | null, alat: string): Promise<string | null> {
  const sql = db();
  if (brand) {
    const [r] = await sql`SELECT norm_brand(${brand}) AS b`;
    return r?.b ? String(r.b) : brand;
  }
  if (dealId) {
    const [d] = await sql`SELECT NULLIF(btrim(brand),'') AS b FROM deal WHERE deal_id = ${dealId}::uuid`;
    if (d?.b) return String(d.b);
  }
  const kata = alat.trim().split(/\s+/)[0] ?? "";
  if (!kata) return null;
  const [r] = await sql`
    SELECT COALESCE(
      (SELECT canonical FROM brand_alias WHERE alias_key = brand_key(${kata}) AND kind = 'brand'),
      (SELECT min(brand) FROM deal WHERE brand_key(brand) = brand_key(${kata}) AND NULLIF(btrim(brand),'') IS NOT NULL)
    ) AS b`;
  return r?.b ? String(r.b) : null;
}

async function cabangAm(amId: string | null): Promise<string | null> {
  if (!amId) return null;
  const [mu] = await db()`SELECT NULLIF(btrim(cabang),'') AS cabang FROM master_user WHERE am_id = ${amId}`;
  return mu?.cabang ? String(mu.cabang).toUpperCase() : null;
}

export interface BukaInput {
  jenis: JenisDT; facility_name: string; alat: string; brand?: string | null; tanggal?: string | null;
  tanggal_selesai?: string | null; hari?: number | null; catatan?: string | null; deal_id?: string | null;
  am_id?: string | null; account_id?: number | null; source: "wa" | "web" | "pipeline";
}

export async function bukaDemoTrial(
  x: BukaInput,
  meta: { created_by: string | null; group_jid?: string | null; wa_message_id?: string | null },
): Promise<{ row: DemoTrialRow; baru: boolean }> {
  const sql = db();
  if (meta.wa_message_id) {
    const [ada] = await sql`${selectDT(sql)} WHERE t.wa_message_id = ${meta.wa_message_id}`;
    if (ada) return { row: toRow(ada), baru: false };
  }
  let facility = bersih(x.facility_name, 200);
  const alat = bersih(x.alat, 200);
  if (x.deal_id) {
    // Dari kartu deal: faskes SELALU milik deal itu, bukan isian klien.
    const [d] = await sql`SELECT COALESCE(NULLIF(btrim(facility_name),''), customer_name) AS nama FROM deal WHERE deal_id = ${x.deal_id}::uuid`;
    if (d?.nama) facility = String(d.nama);
  }
  if (!facility) throw new DemoTrialError(400, "nama faskes wajib diisi");
  if (!alat) throw new DemoTrialError(400, "alat/produk wajib diisi");
  if (x.jenis !== "demo" && x.jenis !== "trial") throw new DemoTrialError(400, "jenis harus demo atau trial");
  const tanggal = x.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(x.tanggal) ? x.tanggal : wibHariIni();
  let selesai: string | null = null;
  if (x.jenis === "trial") {
    selesai = x.tanggal_selesai && /^\d{4}-\d{2}-\d{2}$/.test(x.tanggal_selesai) ? x.tanggal_selesai
      : tambahHari(tanggal, x.hari && x.hari > 0 ? Math.min(x.hari, 365) : TRIAL_HARI_DEFAULT);
    if (selesai < tanggal) throw new DemoTrialError(400, "tanggal selesai trial sebelum tanggal mulai");
  }

  let dealId: string | null = bersih(x.deal_id, 64);
  let amId: string | null = bersih(x.am_id, 64);
  let cabang: string | null = null;
  if (dealId) {
    const [d] = await sql`SELECT am_id, NULLIF(btrim(cabang),'') AS cabang, account_id FROM deal WHERE deal_id = ${dealId}::uuid`;
    if (!d) throw new DemoTrialError(400, "deal tak ditemukan");
    amId = amId ?? (d.am_id ? String(d.am_id) : null);
    cabang = d.cabang ? String(d.cabang).toUpperCase() : null;
    if (x.account_id == null && d.account_id != null) x.account_id = Number(d.account_id);
  }
  cabang = (await cabangAm(amId)) ?? cabang;
  if (!dealId) dealId = await tebakDeal(facility, x.account_id ?? null, alat);
  const brand = await tebakBrand(bersih(x.brand, 100), dealId, alat);

  const [r] = await sql`
    INSERT INTO demo_trial (jenis, kode, facility_name, account_id, deal_id, alat, brand, tanggal, tanggal_selesai, catatan,
                            am_id, cabang, source, created_by, group_jid, wa_message_id)
    VALUES (${x.jenis}, '', ${facility}, ${x.account_id ?? null}, ${dealId}, ${alat}, ${brand}, ${tanggal},
            ${selesai}, ${bersih(x.catatan, 2000)}, ${amId}, ${cabang}, ${x.source}, ${meta.created_by},
            ${meta.group_jid ?? null}, ${meta.wa_message_id ?? null})
    ON CONFLICT (wa_message_id) DO NOTHING
    RETURNING id`;
  if (!r) {
    const [lama] = await sql`${selectDT(sql)} WHERE t.wa_message_id = ${meta.wa_message_id ?? null}`;
    return { row: toRow(lama), baru: false };
  }
  const [row] = await sql`${selectDT(sql)} WHERE t.id = ${r.id}`;
  return { row: toRow(row), baru: true };
}

/** Tutup dengan hasil. `ref` = id angka atau kode DM-/TR-. Hanya yang masih terbuka. */
export async function tutupDemoTrial(scope: DataScope, ref: string, hasil: string, alasan: string | null, oleh: string | null): Promise<DemoTrialRow> {
  const sql = db();
  if (!HASIL.includes(hasil as HasilDT)) throw new DemoTrialError(400, "hasil harus positif, netral, atau negatif");
  const cur = await getDemoTrial(scope, ref);
  if (!cur) throw new DemoTrialError(404, `${ref} tak ditemukan`);
  if (cur.hasil) throw new DemoTrialError(409, `${cur.kode} sudah ditutup (${cur.hasil})`);
  if (hasil !== "positif" && !bersih(alasan)) throw new DemoTrialError(400, "alasan wajib diisi untuk hasil netral/negatif");
  const [u] = await sql`
    UPDATE demo_trial SET hasil = ${hasil}, alasan_hasil = ${bersih(alasan, 2000)}, ditutup_at = now(),
           ditutup_oleh = ${oleh}, updated_at = now()
    WHERE id = ${cur.id} AND hasil IS NULL RETURNING id`;
  if (!u) throw new DemoTrialError(409, `${cur.kode} sudah ditutup orang lain`);
  return (await getDemoTrial(scope, cur.id))!;
}

/** Ubah isi yang masih terbuka (tanggal selesai trial, alat, catatan, tautan deal). */
export async function ubahDemoTrial(scope: DataScope, id: string, input: Record<string, unknown>): Promise<DemoTrialRow> {
  const sql = db();
  const cur = await getDemoTrial(scope, id);
  if (!cur) throw new DemoTrialError(404, "tak ditemukan");
  if (cur.hasil) throw new DemoTrialError(409, `${cur.kode} sudah ditutup — tak bisa diubah`);
  const set: Record<string, unknown> = {};
  for (const k of ["alat", "brand", "catatan"] as const) if (k in input) set[k] = bersih(input[k], k === "catatan" ? 2000 : 200);
  if ("alat" in set && !set.alat) throw new DemoTrialError(400, "alat/produk wajib diisi");
  if ("tanggal_selesai" in input) {
    if (cur.jenis !== "trial") throw new DemoTrialError(400, "hanya trial yang punya tanggal selesai");
    const t = String(input.tanggal_selesai ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || t < cur.tanggal) throw new DemoTrialError(400, "tanggal selesai tidak valid");
    set.tanggal_selesai = t;
    set.reminder_at = null; // diperpanjang → pengingat berikutnya boleh terkirim lagi
  }
  if ("deal_id" in input) {
    const d = bersih(input.deal_id, 64);
    if (d) {
      const [ada] = await sql`SELECT 1 FROM deal WHERE deal_id = ${d}::uuid`;
      if (!ada) throw new DemoTrialError(400, "deal tak ditemukan");
    }
    set.deal_id = d;
  }
  if (Object.keys(set).length === 0) return cur;
  set.updated_at = sql`now()`;
  await sql`UPDATE demo_trial SET ${sql(set)} WHERE id = ${cur.id}`;
  return (await getDemoTrial(scope, cur.id))!;
}

// ── Baca (ber-scope) ────────────────────────────────────────────────────────

export async function getDemoTrial(scope: DataScope, ref: string): Promise<DemoTrialRow | null> {
  const sql = db();
  const byKode = KODE.test(ref);
  if (!byKode && !/^\d+$/.test(ref)) return null;
  const [r] = await sql`
    ${selectDT(sql)}
    WHERE ${byKode ? sql`t.kode = ${ref.toUpperCase()}` : sql`t.id = ${ref}`}
      ${scopeOnClause(sql, scope, sql`t.am_id`, sql`t.cabang`)}`;
  return r ? toRow(r) : null;
}

export interface DTFilter { jenis?: string | null; status?: "terbuka" | "ditutup" | null; am_id?: string | null; deal_id?: string | null }

export async function listDemoTrial(scope: DataScope, f: DTFilter = {}): Promise<DemoTrialRow[]> {
  const sql = db();
  const rows = await sql`
    ${selectDT(sql)}
    WHERE true ${scopeOnClause(sql, scope, sql`t.am_id`, sql`t.cabang`)}
      ${f.jenis === "demo" || f.jenis === "trial" ? sql`AND t.jenis = ${f.jenis}` : sql``}
      ${f.status === "terbuka" ? sql`AND t.hasil IS NULL` : f.status === "ditutup" ? sql`AND t.hasil IS NOT NULL` : sql``}
      ${f.am_id ? sql`AND t.am_id = ${f.am_id}` : sql``}
      ${f.deal_id ? sql`AND t.deal_id = ${f.deal_id}::uuid` : sql``}
    ORDER BY (t.hasil IS NULL) DESC, t.tanggal DESC, t.id DESC
    LIMIT 500`;
  return rows.map(toRow);
}

export interface BarisKonversi { kunci: string; jenis: JenisDT; total: number; ditutup: number; positif: number; netral: number; negatif: number; rate: number | null }

/** Rekap konversi per produk (brand bila ada, kalau tidak teks alat) — murni atas baris yang sudah di-scope. */
export function rekapKonversi(rows: Pick<DemoTrialRow, "jenis" | "brand" | "alat" | "hasil">[], per: "produk" | "jenis" = "produk"): BarisKonversi[] {
  const m = new Map<string, BarisKonversi>();
  for (const r of rows) {
    const kunci = per === "jenis" ? r.jenis : (r.brand?.trim() || r.alat.trim()).replace(/\s+/g, " ");
    const k = `${r.jenis}|${kunci.toLowerCase()}`;
    const b = m.get(k) ?? { kunci, jenis: r.jenis, total: 0, ditutup: 0, positif: 0, netral: 0, negatif: 0, rate: null };
    b.total += 1;
    if (r.hasil) { b.ditutup += 1; b[r.hasil] += 1; }
    m.set(k, b);
  }
  return [...m.values()]
    .map((b) => ({ ...b, rate: b.ditutup ? Math.round((b.positif / b.ditutup) * 1000) / 10 : null }))
    .sort((a, b) => b.total - a.total || a.kunci.localeCompare(b.kunci));
}

/** Apakah deal terlihat oleh scope ini (AM = miliknya, HoD = cabang timnya)? */
export async function dealTerlihat(scope: DataScope, dealId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) return false;
  const sql = db();
  const [r] = await sql`
    SELECT 1 FROM deal d LEFT JOIN master_user mu ON mu.am_id = d.am_id
    WHERE d.deal_id = ${dealId}::uuid
      ${scopeOnClause(sql, scope, sql`d.am_id`, sql`COALESCE(NULLIF(d.cabang,''), NULLIF(mu.cabang,''))`)}`;
  return Boolean(r);
}

// ── WA: resolusi faskes + balasan ───────────────────────────────────────────

export type ResolusiFaskes = { kind: "one"; name: string; account_id: number } | { kind: "prospek"; name: string } | { kind: "ambiguous"; names: string[] };

/** Cocokkan ke master Accurate; tak ketemu = calon pelanggan (dicatat dgn nama ketikan). */
export async function resolusiFaskes(q: string): Promise<ResolusiFaskes> {
  const a = await cariAkun(q);
  if (a.kind === "one" && a.ids.length) return { kind: "one", name: a.name, account_id: a.ids[0] };
  if (a.kind === "ambiguous") return { kind: "ambiguous", names: a.names };
  return { kind: "prospek", name: q };
}

const tgl = (iso: string) => new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

export function balasanBuka(r: Pick<DemoTrialRow, "kode" | "jenis" | "facility_name" | "alat" | "tanggal_selesai" | "deal_id" | "account_id">, nama: string, defaultHari: boolean): string {
  const baris = [
    `✅ ${r.jenis === "demo" ? "Demo" : "Trial"} *${r.kode}* tercatat: ${r.alat} di *${r.facility_name}*, ${nama}.`,
    r.jenis === "trial" && r.tanggal_selesai ? `🗓 Trial selesai ${tgl(r.tanggal_selesai)}${defaultHari ? ` (default ${TRIAL_HARI_DEFAULT} hari — ubah di menu Demo & Trial bila beda)` : ""}.` : null,
    r.deal_id ? "🔗 Tertaut ke deal faskes ini di Pipeline." : null,
    !r.account_id ? "ℹ️ Faskes belum ada di data pelanggan Accurate — dicatat sebagai calon pelanggan." : null,
    "",
    `Kalau sudah ada hasilnya: *${TAG[r.jenis]} ${r.kode} positif|netral|negatif: alasan*`,
  ];
  return baris.filter((b) => b !== null).join("\n");
}

export function balasanAmbiguDT(jenis: JenisDT, q: string, names: string[], alat: string): string {
  return (
    `🔎 "${q}" cocok ke ${names.length} faskes — ${TAG[jenis]} BELUM dicatat. Sebutkan yang mana:\n` +
    names.map((n) => `• ${n}`).join("\n") +
    `\n\nKetik ulang, mis. *${TAG[jenis]} ${names[0]}: ${alat}*`
  );
}

export function balasanTutup(r: Pick<DemoTrialRow, "kode" | "facility_name" | "hasil">, nama: string): string {
  const ikon = r.hasil === "positif" ? "🟢" : r.hasil === "negatif" ? "🔴" : "🟡";
  return `${ikon} *${r.kode}* (${r.facility_name}) ditutup: *${r.hasil}*, ${nama}.`;
}

// ── Pengingat trial berakhir (job trial-reminder) ───────────────────────────

/**
 * Trial yang tanggal selesainya sudah lewat/hari ini tapi belum ditutup → DM
 * ringkasan ke AM pemiliknya, sekali per trial (reminder_at). Penanda hanya
 * ditulis bila WA terkirim LIVE (pola F38/F45/LPSE/F65).
 */
export async function runTrialReminder(): Promise<{ terkirim: number; lewati: string[] }> {
  const sql = db();
  const rows = await sql`
    SELECT t.id, t.kode, t.facility_name, t.alat, t.tanggal_selesai::text, t.am_id,
           NULLIF(mu.nama,'') AS am_nama, NULLIF(btrim(mu.wa_number),'') AS am_wa
    FROM demo_trial t LEFT JOIN master_user mu ON mu.am_id = t.am_id
    WHERE t.jenis = 'trial' AND t.hasil IS NULL AND t.reminder_at IS NULL
      AND t.tanggal_selesai <= (now() AT TIME ZONE 'Asia/Jakarta')::date
    ORDER BY t.tanggal_selesai`;
  const per = new Map<string, typeof rows>();
  const lewati: string[] = [];
  for (const r of rows) {
    if (!r.am_id) { lewati.push(`${r.kode}: belum ber-AM`); continue; }
    per.set(String(r.am_id), [...(per.get(String(r.am_id)) ?? []), r] as typeof rows);
  }
  let terkirim = 0;
  for (const [amId, ls] of per) {
    const wa = ls[0].am_wa ? String(ls[0].am_wa) : null;
    if (!wa) { lewati.push(`AM ${amId}: nomor WA kosong`); continue; }
    const pesan = [
      `⏰ *Trial sudah berakhir* — ${ls[0].am_nama ?? amId}, ${ls.length} trial belum dicatat hasilnya:`,
      ...ls.map((l) => `• ${l.kode} ${l.alat} di ${l.facility_name} (selesai ${tgl(String(l.tanggal_selesai))})`),
      "",
      "Tutup dengan: *#TRIAL TR-xxxx positif|netral|negatif: alasan* — atau perpanjang tanggalnya di menu Demo & Trial.",
    ].join("\n");
    const gw = await sendViaWaGateway(wa, pesan);
    if (gw.sent && !gw.stub && !gw.dryRun) {
      await sql`UPDATE demo_trial SET reminder_at = now() WHERE id = ANY(${ls.map((l) => l.id)}::bigint[])`;
      terkirim += 1;
    }
  }
  return { terkirim, lewati };
}

export { wibHariIni };
