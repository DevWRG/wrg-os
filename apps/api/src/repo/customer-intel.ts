// F131 Customer Intelligence + Competitor Watch.
//
// (a) Briefing pra-kunjungan per faskes — FAKTA saja, tanpa LLM (keputusan user
//     13 Okt 2026): pembelian, piutang, kunjungan & catatan terakhir, deal
//     terbuka, aset KSO, demo/trial berjalan, sebutan kompetitor, dan kompetitor
//     dominan yang sudah dikonfirmasi HoD di wilayahnya. Lewat WA #BRIEF dan
//     panel di halaman faskes (Accounts 360).
// (b) Kompetitor dominan per wilayah — deteksi dari competitor_intel (dominasi
//     sebutan per cabang × kategori) + konfirmasi HoD (competitor_dominan).
//
// Sebutan brand Wahana sendiri (brand_sendiri, migrasi 215) TIDAK dihitung
// sebagai kompetitor — di prod 33% sebutan lama ternyata brand sendiri.
//
// Akses briefing: admin semua; AM = faskes miliknya + yang BELUM punya pemilik
// (AM sering mengunjungi calon pelanggan); HoD = milik timnya + tanpa pemilik.
// Faskes milik AM lain ditolak.

import { db } from "../db.js";
import type { DataScope } from "./access-scope.js";
import { cariAkun, INTI_MATCH, NAMA_MATCH } from "./interaction.js";
import { normalizeAccurateDate } from "./ar.js";
import { ringkasPembayaran, trenBayar, type StatBayar } from "./pembayaran.js";

export class IntelError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Sql = ReturnType<typeof db>;

const hariIniWib = (now: Date = new Date()): string => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const selisihHari = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// Cocokkan nama faskes teks bebas (laporan lama yang belum tertaut akun) ke
// nama faskes Accurate — syarat yang SAMA dgn cariAkun (#CALL/#NOTE).
const namaCocok = (sql: Sql, kolom: ReturnType<Sql>, nama: string) => sql`
  (${kolom} IS NOT NULL
   AND (similarity(${kolom}, ${nama}) >= ${NAMA_MATCH}
        OR similarity(faskes_inti(${kolom}), faskes_inti(${nama})) >= ${INTI_MATCH})
   AND faskes_cocok(${kolom}, ${nama}))`;

// ── Brand sendiri ─────────────────────────────────────────────────────────

/** Segarkan daftar brand yang dijual Wahana (faktur 24 bln terakhir, via item_brand). */
export async function segarkanBrandSendiri(): Promise<number> {
  const rows = await db()`
    INSERT INTO brand_sendiri (brand, terakhir)
    SELECT b.brand, max(b.tanggal)
    FROM (
      SELECT item_brand(x.item_id) AS brand, x.tanggal
      FROM (SELECT aii.item_id, max(ai.tanggal) AS tanggal
            FROM accurate_invoice_item aii JOIN accurate_invoice ai ON ai.id = aii.invoice_id
            WHERE ai.tanggal >= current_date - interval '24 months'
            GROUP BY aii.item_id) x
    ) b
    WHERE b.brand IS NOT NULL
    GROUP BY b.brand
    ON CONFLICT (brand) DO UPDATE SET terakhir = EXCLUDED.terakhir, diperbarui_at = now()
    RETURNING brand`;
  return rows.length;
}

// ── Akses ─────────────────────────────────────────────────────────────────

async function cekAkses(sql: Sql, sc: DataScope, ids: number[]): Promise<void> {
  if (!sc.amOnly && !sc.cabangScope?.length) return;
  const rows = await sql`
    SELECT oa.owner_am_id, NULLIF(omu.cabang, '') AS cabang, COALESCE(NULLIF(omu.nama, ''), oa.owner_am_id) AS owner_nama
    FROM accurate_customer ac
    LEFT JOIN crm_account oa ON oa.account_id = ac.id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    WHERE ac.id = ANY(${ids}::bigint[])`;
  const scope = (sc.cabangScope ?? []).map((c) => c.trim().toUpperCase());
  const boleh = rows.some((r) =>
    !r.owner_am_id
    || (sc.amOnly && String(r.owner_am_id) === sc.amId)
    || (!sc.amOnly && scope.includes(String(r.cabang ?? "").trim().toUpperCase())));
  if (!boleh) {
    const pemilik = rows.find((r) => r.owner_am_id)?.owner_nama;
    throw new IntelError(403, `faskes ini dipegang ${pemilik ? `AM ${pemilik}` : "AM lain"} — briefing hanya untuk faskes Anda/tim Anda atau yang belum punya pemilik`);
  }
}

// ── Briefing ──────────────────────────────────────────────────────────────

export interface Briefing {
  faskes: { ids: string[]; nama: string; cabang: string | null; tipe: string | null; kelas_rs: string | null; pemilik: string | null };
  kontak: { nama: string; jabatan: string | null; hp_wa: string | null; utama: boolean }[];
  pembelian: { terakhir: string | null; hari_sejak: number | null; netto_12bln: number; faktur_12bln: number; brand_teratas: string[] };
  piutang: { sisa: number; lewat_tempo: { faktur: number; nilai: number; terlama_hari: number } };
  bayar: StatBayar & { tren: "lebih cepat" | "lebih lambat" | "stabil" | null };
  kunjungan: { tanggal: string; am: string | null; tujuan: string | null; hasil: string | null; next_action: string | null }[];
  catatan: { tanggal: string; jenis: string; isi: string; oleh: string }[];
  deal: { stage: string; brand: string | null; produk: string | null; nilai: number | null; hari_di_tahap: number | null; am: string | null }[];
  kso: { aktif: number; alat: string[]; mou_terdekat: string | null };
  demo: { kode: string; jenis: string; alat: string; tanggal: string; tanggal_selesai: string | null }[];
  kompetitor: { tanggal: string; vendor: string; produk: string | null; harga_text: string | null; konteks: string | null }[];
  dominan_wilayah: { kategori: string; vendor: string; catatan: string | null }[];
  hari_ini: string;
}

const potong = (s: unknown, n: number): string | null => {
  const t = s == null ? "" : String(s).replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
};

export async function briefingFaskes(sc: DataScope, ids: number[]): Promise<Briefing> {
  if (!ids.length || ids.some((i) => !Number.isSafeInteger(i) || i <= 0)) throw new IntelError(400, "id faskes tidak sah");
  const sql = db();
  const [base] = await sql`
    SELECT COALESCE(NULLIF(ac.name, ''), ac.raw->>'name', 'Customer #' || ac.id::text) AS nama,
           upper(btrim(NULLIF(area_customer(ac.id), ''))) AS cabang,
           oa.tipe, oa.kelas_rs, COALESCE(NULLIF(omu.nama, ''), oa.owner_am_id) AS pemilik
    FROM accurate_customer ac
    LEFT JOIN crm_account oa ON oa.account_id = ac.id
    LEFT JOIN master_user omu ON omu.am_id = oa.owner_am_id
    WHERE ac.id = ${ids[0]}`;
  if (!base) throw new IntelError(404, "faskes tak ditemukan");
  await cekAkses(sql, sc, ids);
  const nama = String(base.nama);
  const hari = hariIniWib();

  const [kontak, [beli], brand, faktur, kunj, cat, deal, kso, demo, komp] = await Promise.all([
    sql`SELECT nama, jabatan, hp_wa, is_primary FROM crm_contact WHERE account_id = ANY(${ids}::bigint[])
        ORDER BY is_primary DESC, seq, id LIMIT 3`,
    sql`SELECT max(ai.tanggal)::text AS terakhir,
               COALESCE(sum(ai.total - COALESCE(ai.tax_amount, 0)) FILTER (WHERE ai.tanggal > current_date - 365), 0)::float8 AS netto,
               count(*) FILTER (WHERE ai.tanggal > current_date - 365)::int AS faktur
        FROM accurate_invoice ai WHERE ai.customer_id = ANY(${ids}::bigint[])`,
    sql`SELECT item_brand(aii.item_id) AS brand, sum(GREATEST(aii.total, 0)) AS w
        FROM accurate_invoice_item aii JOIN accurate_invoice ai ON ai.id = aii.invoice_id
        WHERE ai.customer_id = ANY(${ids}::bigint[]) AND ai.tanggal > current_date - 365
        GROUP BY 1 HAVING item_brand(aii.item_id) IS NOT NULL ORDER BY 2 DESC LIMIT 3`,
    sql`SELECT ai.outstanding::float8 AS sisa, ai.raw->>'dueDate' AS due_raw
        FROM accurate_invoice ai WHERE ai.customer_id = ANY(${ids}::bigint[]) AND ai.outstanding > 0`,
    sql`SELECT al.tanggal::text, COALESCE(NULLIF(mu.nama, ''), al.am_id) AS am, al.tujuan, al.hasil, al.next_action
        FROM activity_log al LEFT JOIN master_user mu ON mu.am_id = al.am_id
        -- Hanya lewat tautan account_id, sama dengan Timeline Accounts. Tebakan
        -- nama yang dulu ada di sini mencampur faskes sekota (Puskesmas, RSUD &
        -- Labkesda Trenggalek tampil di satu faskes, 13 Okt 2026); tautannya kini
        -- diisi penaut sadar-jenis (akun-faskes.ts) + skrip tautkan-kunjungan-akun.
        WHERE al.account_id = ANY(${ids}::bigint[])
        ORDER BY al.tanggal DESC, al.id DESC LIMIT 3`,
    sql`SELECT il.created_at::date::text AS tanggal, il.jenis, il.isi, il.pencatat_nama AS oleh
        FROM interaction_log il WHERE il.account_id = ANY(${ids}::bigint[]) ORDER BY il.created_at DESC LIMIT 2`,
    sql`SELECT d.stage::text AS stage, d.brand, d.product, COALESCE(d.estimated_value, d.estimate_amount)::float8 AS nilai,
               (current_date - d.stage_entered_at::date)::int AS hari, COALESCE(NULLIF(mu.nama, ''), d.am_id) AS am
        FROM deal d LEFT JOIN master_user mu ON mu.am_id = d.am_id
        WHERE d.stage::text NOT IN ('Closing-Won', 'Closing-Lost')
          AND (d.account_id = ANY(${ids}::bigint[])
               OR (d.account_id IS NULL AND ${namaCocok(sql, sql`d.facility_name`, nama)}))
        ORDER BY COALESCE(d.estimated_value, d.estimate_amount) DESC NULLS LAST LIMIT 5`,
    sql`SELECT COALESCE(NULLIF(a.nama_alat, ''), a.type_alat) AS alat, a.mou_berlaku_sampai::text AS mou
        FROM kso_asset a JOIN kso_asset_status_v v ON v.id = a.id
        WHERE a.account_id = ANY(${ids}::bigint[]) AND v.status_kode = 'operasional'`,
    sql`SELECT kode, jenis, alat, tanggal::text, tanggal_selesai::text
        FROM demo_trial WHERE account_id = ANY(${ids}::bigint[]) AND hasil IS NULL ORDER BY tanggal DESC LIMIT 3`,
    sql`SELECT ci.tanggal::text, norm_vendor(ci.vendor) AS vendor, ci.produk, ci.harga_text, ci.konteks
        FROM competitor_intel ci
        WHERE ci.tanggal > current_date - 365
          AND norm_vendor(ci.vendor) IS NOT NULL
          AND norm_vendor(ci.vendor) NOT IN (SELECT brand FROM brand_sendiri)
          AND (ci.account_id = ANY(${ids}::bigint[])
               OR (ci.account_id IS NULL AND ${namaCocok(sql, sql`ci.customer_name`, nama)}))
        ORDER BY ci.tanggal DESC, ci.created_at DESC LIMIT 6`,
  ]);

  const bayar = await ringkasPembayaran(ids);
  const dominan = base.cabang
    ? await sql`SELECT kategori, vendor, catatan FROM competitor_dominan
                WHERE status = 'dikonfirmasi' AND upper(btrim(cabang)) = ${String(base.cabang)} ORDER BY kategori`
    : [];

  let lewatN = 0, lewatNilai = 0, terlama = 0, sisa = 0;
  for (const f of faktur) {
    const n = Number(f.sisa) || 0;
    sisa += n;
    const due = normalizeAccurateDate(f.due_raw == null ? undefined : String(f.due_raw));
    if (due && due < hari) { lewatN += 1; lewatNilai += n; terlama = Math.max(terlama, selisihHari(due, hari)); }
  }
  const mou = kso.map((k) => k.mou as string | null).filter((m): m is string => !!m && m >= hari).sort()[0] ?? null;

  return {
    faskes: { ids: ids.map(String), nama, cabang: base.cabang ?? null, tipe: base.tipe ?? null, kelas_rs: base.kelas_rs ?? null, pemilik: base.pemilik ?? null },
    kontak: kontak.map((k) => ({ nama: String(k.nama), jabatan: k.jabatan ?? null, hp_wa: k.hp_wa ?? null, utama: Boolean(k.is_primary) })),
    pembelian: {
      terakhir: beli?.terakhir ?? null,
      hari_sejak: beli?.terakhir ? selisihHari(String(beli.terakhir), hari) : null,
      netto_12bln: Number(beli?.netto) || 0, faktur_12bln: Number(beli?.faktur) || 0,
      brand_teratas: brand.map((b) => String(b.brand)),
    },
    piutang: { sisa, lewat_tempo: { faktur: lewatN, nilai: lewatNilai, terlama_hari: terlama } },
    bayar: { ...bayar.bayar_12bln, tren: trenBayar(bayar.bayar_12bln, bayar.bayar_sebelumnya) },
    kunjungan: kunj.map((k) => ({ tanggal: String(k.tanggal), am: k.am ?? null, tujuan: potong(k.tujuan, 60), hasil: potong(k.hasil, 220), next_action: potong(k.next_action, 120) })),
    catatan: cat.map((c) => ({ tanggal: String(c.tanggal), jenis: String(c.jenis), isi: potong(c.isi, 200) ?? "", oleh: String(c.oleh) })),
    deal: deal.map((d) => ({ stage: String(d.stage), brand: d.brand ?? null, produk: potong(d.product, 60), nilai: d.nilai == null ? null : Number(d.nilai), hari_di_tahap: d.hari == null ? null : Number(d.hari), am: d.am ?? null })),
    kso: { aktif: kso.length, alat: [...new Set(kso.map((k) => String(k.alat ?? "")).filter(Boolean))].slice(0, 4), mou_terdekat: mou },
    demo: demo.map((d) => ({ kode: String(d.kode), jenis: String(d.jenis), alat: String(d.alat), tanggal: String(d.tanggal), tanggal_selesai: d.tanggal_selesai ?? null })),
    kompetitor: komp.map((k) => ({ tanggal: String(k.tanggal), vendor: String(k.vendor), produk: potong(k.produk, 60), harga_text: potong(k.harga_text, 40), konteks: potong(k.konteks, 120) })),
    dominan_wilayah: dominan.map((d) => ({ kategori: String(d.kategori), vendor: String(d.vendor), catatan: d.catatan ?? null })),
    hari_ini: hari,
  };
}

// ── Format WA (murni) ─────────────────────────────────────────────────────

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tglPendek = (d: string, tahun = false): string => {
  const [y, m, h] = d.split("-").map(Number);
  return `${h} ${BULAN[m - 1]}${tahun ? ` ${y}` : ""}`;
};
export function rpWa(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2).replace(".", ",")} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${Math.round(v / 1e6).toLocaleString("id-ID")} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

export function formatBriefWa(b: Briefing): string {
  const f = b.faskes;
  const out: string[] = [];
  out.push(`🧭 *Brief: ${f.nama}*${f.cabang ? ` (${f.cabang})` : ""}`);
  const pic = b.kontak[0];
  const baris2 = [f.pemilik ? `Pemilik: ${f.pemilik}` : "Belum ada AM pemilik", pic ? `PIC: ${pic.nama}${pic.jabatan ? ` (${pic.jabatan})` : ""}${pic.hp_wa ? ` ${pic.hp_wa}` : ""}` : "PIC belum dicatat"];
  out.push(baris2.join(" · "));

  const p = b.pembelian;
  out.push(p.terakhir
    ? `🧾 Beli terakhir ${tglPendek(p.terakhir, true)} (${p.hari_sejak} hari lalu) · 12 bln: ${rpWa(p.netto_12bln)} (${p.faktur_12bln} faktur)${p.brand_teratas.length ? ` · ${p.brand_teratas.join(", ")}` : ""}`
    : "🧾 Belum pernah ada faktur — calon pelanggan.");
  if (b.piutang.sisa > 0) {
    const l = b.piutang.lewat_tempo;
    out.push(`💰 Piutang ${rpWa(b.piutang.sisa)}${l.faktur ? ` · lewat jatuh tempo ${l.faktur} faktur ${rpWa(l.nilai)} (terlama ${l.terlama_hari} hari)` : " · belum ada yang lewat jatuh tempo"}`);
  }
  if (b.bayar.faktur > 0) {
    out.push(`⏱️ Bayar (12 bln, ${b.bayar.faktur} faktur): median ${b.bayar.median_hari} hari setelah faktur${b.bayar.tepat_pct != null ? ` · ${b.bayar.tepat_pct}% tepat waktu` : ""}${b.bayar.rata_telat_hari ? ` · telat rata-rata ${b.bayar.rata_telat_hari} hari` : ""}${b.bayar.tren ? ` · ${b.bayar.tren} dari tahun sebelumnya` : ""}`);
  }
  if (b.kso.aktif) out.push(`🔬 KSO aktif: ${b.kso.aktif} alat${b.kso.alat.length ? ` (${b.kso.alat.join(", ")})` : ""}${b.kso.mou_terdekat ? ` · MoU terdekat habis ${tglPendek(b.kso.mou_terdekat, true)}` : ""}`);
  for (const d of b.deal.slice(0, 3)) {
    out.push(`🤝 Deal ${d.stage}: ${[d.brand, d.produk].filter(Boolean).join(" ") || "—"}${d.nilai ? ` ${rpWa(d.nilai)}` : ""}${d.hari_di_tahap != null ? ` · ${d.hari_di_tahap} hari di tahap ini` : ""}`);
  }
  for (const d of b.demo) out.push(`🧪 ${d.jenis === "trial" ? "Trial" : "Demo"} ${d.kode} ${d.alat}${d.tanggal_selesai ? ` s/d ${tglPendek(d.tanggal_selesai)}` : ""} — belum ada hasil`);
  if (b.kunjungan.length) {
    out.push("📝 *Kunjungan terakhir:*");
    for (const k of b.kunjungan) {
      out.push(`• ${tglPendek(k.tanggal)}${k.am ? ` (${k.am})` : ""}${k.tujuan ? ` ${k.tujuan}` : ""}: ${k.hasil ?? "—"}${k.next_action ? ` → Next: ${k.next_action}` : ""}`);
    }
  } else out.push("📝 Belum ada laporan kunjungan tercatat.");
  for (const c of b.catatan) out.push(`🗒️ ${tglPendek(c.tanggal)} ${c.jenis === "call" ? "Telepon" : "Catatan"} (${c.oleh}): ${c.isi}`);
  if (b.kompetitor.length) {
    out.push("⚔️ *Kompetitor disebut (12 bln):*");
    for (const k of b.kompetitor.slice(0, 4)) {
      out.push(`• ${tglPendek(k.tanggal)} ${k.vendor}${k.produk ? ` ${k.produk}` : ""}${k.harga_text ? ` (${k.harga_text})` : ""}`);
    }
  }
  if (b.dominan_wilayah.length) out.push(`🏁 Dominan di wilayah: ${b.dominan_wilayah.map((d) => `${d.kategori} — ${d.vendor}`).join("; ")}`);
  return out.join("\n");
}

// ── WA #BRIEF ─────────────────────────────────────────────────────────────

export async function balasanBrief(arg: string, sc: DataScope): Promise<string> {
  const q = arg.replace(/^[:\s-]+/, "").trim();
  if (!q) return "⚠️ Sebutkan faskesnya setelah #BRIEF. Contoh: *#BRIEF RSUD dr Soedono Madiun*";
  const r = await cariAkun(q);
  if (r.kind === "none") return `🔎 Faskes "${q}" tidak ditemukan di data Accurate. Coba tulis nama lengkap + kotanya.`;
  if (r.kind === "ambiguous") {
    return `🔎 "${q}" cocok ke ${r.names.length} faskes. Sebutkan yang mana:\n${r.names.slice(0, 8).map((n) => `• ${n}`).join("\n")}\n\nKetik ulang, mis. *#BRIEF ${r.names[0]}*`;
  }
  try {
    return formatBriefWa(await briefingFaskes(sc, r.ids));
  } catch (e) {
    if (e instanceof IntelError && e.status === 403) return `⛔ ${e.message}.`;
    throw e;
  }
}

// ── Kompetitor dominan per wilayah ───────────────────────────────────────

export const DOMINAN_MIN_SEBUTAN = 5;
export const DOMINAN_MIN_PANGSA = 0.6;

export interface SelDominasi {
  cabang: string;
  kategori: string;
  total: number;
  vendor: string;
  sebutan: number;
  pangsa: number;
  runner_up: { vendor: string; sebutan: number } | null;
  dugaan: boolean;
  status: "dikonfirmasi" | "ditolak" | null;
  catatan: string | null;
  oleh: string | null;
}

/** Murni: rakit sel cabang × kategori dari hitungan per vendor. */
export function rakitDominasi(
  baris: { cabang: string; kategori: string; vendor: string; n: number }[],
  konfirmasi: { cabang: string; kategori: string; vendor: string; status: string; catatan: string | null; oleh: string | null }[],
): SelDominasi[] {
  const sel = new Map<string, { cabang: string; kategori: string; v: { vendor: string; n: number }[] }>();
  for (const b of baris) {
    const k = `${b.cabang}|${b.kategori}`;
    const s = sel.get(k) ?? { cabang: b.cabang, kategori: b.kategori, v: [] };
    s.v.push({ vendor: b.vendor, n: b.n });
    sel.set(k, s);
  }
  const kon = new Map(konfirmasi.map((c) => [`${c.cabang}|${c.kategori}|${c.vendor}`, c]));
  const out: SelDominasi[] = [];
  for (const s of sel.values()) {
    s.v.sort((a, b) => b.n - a.n || a.vendor.localeCompare(b.vendor));
    const total = s.v.reduce((t, x) => t + x.n, 0);
    const top = s.v[0];
    const pangsa = total ? top.n / total : 0;
    const c = kon.get(`${s.cabang}|${s.kategori}|${top.vendor}`);
    out.push({
      cabang: s.cabang, kategori: s.kategori, total, vendor: top.vendor, sebutan: top.n,
      pangsa: Math.round(pangsa * 1000) / 1000,
      runner_up: s.v[1] ? { vendor: s.v[1].vendor, sebutan: s.v[1].n } : null,
      dugaan: total >= DOMINAN_MIN_SEBUTAN && pangsa >= DOMINAN_MIN_PANGSA,
      status: c ? (c.status as SelDominasi["status"]) : null,
      catatan: c?.catatan ?? null, oleh: c?.oleh ?? null,
    });
  }
  return out.sort((a, b) => Number(b.dugaan) - Number(a.dugaan) || b.total - a.total);
}

export async function dominasiWilayah(hari = 365): Promise<{ hari: number; sel: SelDominasi[]; brand_sendiri: number }> {
  const h = Math.min(Math.max(Math.round(hari) || 365, 30), 730);
  const sql = db();
  const [baris, konfirmasi, [bs]] = await Promise.all([
    sql`
      WITH m AS (
        SELECT norm_vendor(ci.vendor) AS vendor,
               btrim(split_part(COALESCE(ci.produk_kategori, ''), '|', 1)) AS kategori,
               upper(btrim(COALESCE(NULLIF(area_customer(ci.account_id), ''), NULLIF(mu.cabang, ''), ''))) AS cabang
        FROM competitor_intel ci
        LEFT JOIN master_user mu ON mu.am_id = ci.am_id
        WHERE ci.tanggal > current_date - ${h}::int
      )
      SELECT cabang, kategori, vendor, count(*)::int AS n
      FROM m
      WHERE vendor IS NOT NULL AND vendor NOT IN (SELECT brand FROM brand_sendiri)
        AND kategori NOT IN ('', 'Other') AND cabang <> ''
      GROUP BY 1, 2, 3`,
    sql`SELECT upper(btrim(cabang)) AS cabang, kategori, vendor, status, catatan, oleh FROM competitor_dominan`,
    sql`SELECT count(*)::int AS n FROM brand_sendiri`,
  ]);
  return {
    hari: h,
    sel: rakitDominasi(
      baris.map((b) => ({ cabang: String(b.cabang), kategori: String(b.kategori), vendor: String(b.vendor), n: Number(b.n) })),
      konfirmasi.map((c) => ({ cabang: String(c.cabang), kategori: String(c.kategori), vendor: String(c.vendor), status: String(c.status), catatan: c.catatan ?? null, oleh: c.oleh ?? null })),
    ),
    brand_sendiri: Number(bs.n),
  };
}

/** HoD/admin mengonfirmasi / menolak / menghapus penilaian dominan. HoD hanya cabang timnya. */
export async function setDominan(sc: DataScope, body: Record<string, unknown>, oleh: string | null) {
  if (sc.amOnly || String(sc.role ?? "").toLowerCase() === "viewer") throw new IntelError(403, "hanya HoD/admin yang bisa mengonfirmasi kompetitor dominan");
  const cabang = String(body.cabang ?? "").trim().toUpperCase();
  const kategori = String(body.kategori ?? "").trim();
  const vendor = String(body.vendor ?? "").trim();
  const status = String(body.status ?? "");
  if (!cabang || !kategori || !vendor) throw new IntelError(400, "cabang, kategori, dan vendor wajib");
  if (!["dikonfirmasi", "ditolak", "hapus"].includes(status)) throw new IntelError(400, "status harus dikonfirmasi / ditolak / hapus");
  const scope = (sc.cabangScope ?? []).map((c) => c.trim().toUpperCase());
  if (scope.length && !scope.includes(cabang)) throw new IntelError(403, `cabang ${cabang} di luar tim Anda`);
  const catatan = typeof body.catatan === "string" && body.catatan.trim() ? body.catatan.trim().slice(0, 300) : null;
  const sql = db();
  if (status === "hapus") {
    await sql`DELETE FROM competitor_dominan WHERE upper(btrim(cabang)) = ${cabang} AND kategori = ${kategori} AND vendor = ${vendor}`;
  } else {
    await sql`
      INSERT INTO competitor_dominan (cabang, kategori, vendor, status, catatan, oleh)
      VALUES (${cabang}, ${kategori}, ${vendor}, ${status}, ${catatan}, ${oleh})
      ON CONFLICT (cabang, kategori, vendor) DO UPDATE
        SET status = EXCLUDED.status, catatan = EXCLUDED.catatan, oleh = EXCLUDED.oleh, updated_at = now()`;
  }
  return { ok: true };
}

