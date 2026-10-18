// Pipeline Authenticity (F4 SXR, issue #1784) — apakah deal di Pipeline mencerminkan
// aktivitas nyata. Tab "Keaslian" di Sales Analytics, ber-scope sama dengan Pipeline
// (AM = deal miliknya, HoD = cabang yang dipegang). Status dihitung DETERMINISTIK dari
// data — bukan LLM, bukan tuduhan: alasannya selalu ditulis supaya bisa dicek.
//
// Sinyal (keputusan user 17 Okt 2026, ambang usulan):
//   1. Tanpa kunjungan — deal terbuka tanpa laporan kunjungan (activity_log) ke
//      faskesnya / tertaut ke deal itu dalam 60 hari.
//   2. Macet di tahap — lama di tahap > batas (Prospecting/First Contact 60, Presentation/
//      Quotation/Offering 45, Negotiation 30, Closing 14 hari). Deal "ditahan" (on_hold) dikecualikan.
//   3. Won tanpa faktur — Closing-Won ≤180 hari lalu tanpa faktur Accurate ke faskes
//      itu sejak (Won − 30 hari); baru dinilai bila Won > 60 hari (sebelum itu "menunggu").
//   4. Kunjungan tanpa bukti — ada kunjungan 60 hari, tapi tak satu pun berfoto + bergeotag.
// Status: MERAGUKAN = Won tanpa faktur, ATAU tanpa kunjungan + macet sekaligus;
//         PERLU_CEK = salah satu sinyal lain; TERVERIFIKASI = tak ada.
//
// Deal tanpa account_id (prod 17 Okt: 198/377 terbuka) dicocokkan lewat nama dengan
// penaut faskes yang sama dipakai #REPORT (akun-faskes.ts: jenis = pembeda, ambigu =
// tidak ditautkan). Kunjungan juga dicocokkan lewat nama customer persis (upper/trim)
// sebagai cadangan. Yang tetap tak tertaut = info, tidak menurunkan status.
// Prod 17 Okt: 219/224 deal tanpa akun memang calon pelanggan (belum ada di Accurate) →
// kunjungannya dicocokkan lewat KATA nama (kunjunganCocok): laporan AM YANG SAMA yang
// memuat semua kata inti nama faskes deal, jenis faskes tak bertentangan.

import { db } from "../db.js";
import { scopeOnClause, FULL_SCOPE, type DataScope } from "./access-scope.js";
import { katalogFaskes, tautkanFaskes, uraiTulisanAm } from "./akun-faskes.js";

export type StatusKeaslian = "MERAGUKAN" | "PERLU_CEK" | "TERVERIFIKASI";
export type Tingkat = "meragukan" | "cek" | "info";
export interface Alasan { tingkat: Tingkat; kode: string; teks: string }

export const BATAS_TAHAP: Record<string, number> = {
  Prospecting: 60, "First Contact": 60, Presentation: 45, Quotation: 45, Offering: 45, Negotiation: 30, Closing: 14,
};
export const ATURAN = { tanpa_kunjungan_hari: 60, won_jendela_hari: 180, won_tunggu_hari: 60, faktur_mundur_hari: 30 } as const;

// ── Murni ────────────────────────────────────────────────────────────────

const hari = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tglId = (iso: string): string => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${BLN[m - 1]} ${y}`; };

export interface Kunjungan { tanggal: string; bukti: boolean }
export interface DealInput {
  stage: string;
  stage_masuk: string;          // YYYY-MM-DD
  on_hold: boolean;
  tertaut: boolean;             // punya account (langsung / lewat nama)
  dibuat?: string | null;       // YYYY-MM-DD — untuk penanda "tak pernah pindah tahap"
}

export function nilaiKeaslian(d: DealInput, kunjungan: Kunjungan[], fakturSejak: string | null, hariIni: string) {
  const alasan: Alasan[] = [];
  const tambah = (tingkat: Tingkat, kode: string, teks: string) => alasan.push({ tingkat, kode, teks });
  const terakhir = kunjungan.length ? kunjungan.map((k) => k.tanggal).sort().at(-1)! : null;
  const lamaTahap = Math.max(0, hari(d.stage_masuk, hariIni));
  let tanpaKunjungan = false;
  let macet = false;

  if (d.stage === "Closing-Won") {
    if (!d.tertaut) tambah("info", "won_tak_tertaut", "Faktur tak bisa dicek — deal belum tertaut ke akun faskes");
    else if (fakturSejak) { /* ada faktur → sah */ }
    else if (lamaTahap > ATURAN.won_tunggu_hari) tambah("meragukan", "won_tanpa_faktur", `Won ${lamaTahap} hari lalu (${tglId(d.stage_masuk)}) tapi belum ada faktur Accurate ke faskes ini`);
    else tambah("info", "menunggu_faktur", `Won ${lamaTahap} hari lalu — faktur belum terbit (dinilai sesudah ${ATURAN.won_tunggu_hari} hari)`);
  } else {
    const baru = kunjungan.filter((k) => hari(k.tanggal, hariIni) <= ATURAN.tanpa_kunjungan_hari);
    if (!baru.length) {
      tanpaKunjungan = true;
      tambah("cek", "tanpa_kunjungan", terakhir
        ? `Tanpa kunjungan ${ATURAN.tanpa_kunjungan_hari} hari (terakhir ${tglId(terakhir)})`
        : "Belum ada laporan kunjungan ke faskes ini");
    } else if (!baru.some((k) => k.bukti)) {
      tambah("cek", "tanpa_bukti", `${baru.length} kunjungan ${ATURAN.tanpa_kunjungan_hari} hari terakhir tanpa foto bergeotag`);
    }
    const batas = BATAS_TAHAP[d.stage];
    if (batas != null && !d.on_hold && lamaTahap > batas) {
      macet = true;
      tambah("cek", "macet", `Di tahap ${d.stage} ${lamaTahap} hari (batas ${batas})`);
    }
    if (d.on_hold) tambah("info", "ditahan", "Deal ditahan (on hold) — lama di tahap tidak dinilai");
    // Prod 17 Okt: 93 deal dua AM dibuat sekaligus 30 Jul 2026 (impor awal go-live CRM) dan
    // tak pernah bergerak — konteks penting supaya "meragukan" dibaca "basi", bukan "fiktif".
    if (d.dibuat && d.dibuat === d.stage_masuk && hari(d.dibuat, hariIni) > ATURAN.tanpa_kunjungan_hari) {
      tambah("info", "tak_pernah_bergerak", `Belum pernah pindah tahap sejak dibuat ${tglId(d.dibuat)}`);
    }
    if (!d.tertaut) tambah("info", "tak_tertaut", "Belum tertaut ke akun faskes — kunjungan dicocokkan lewat nama saja");
  }

  const status: StatusKeaslian = alasan.some((a) => a.tingkat === "meragukan") || (tanpaKunjungan && macet)
    ? "MERAGUKAN" : alasan.some((a) => a.tingkat === "cek") ? "PERLU_CEK" : "TERVERIFIKASI";
  return { status, alasan, kunjungan_terakhir: terakhir, lama_tahap: lamaTahap };
}

/**
 * Laporan kunjungan (tulisan bebas AM, mis. "Cust : RSUD Trenggalek") cocok dengan nama
 * faskes deal bila SEMUA kata inti nama deal ada di laporan dan jenis (RS/PKM/…) tak
 * bertentangan. Nama deal tanpa kata inti ("Puskesmas", "Dinas Kesehatan") = tak cocok
 * — terlalu umum. Pemanggil membatasi ke AM yang sama.
 */
export function kunjunganCocok(namaDeal: string | null | undefined, laporan: string | null | undefined): boolean {
  const d = uraiTulisanAm(namaDeal);
  const v = uraiTulisanAm(laporan);
  if (!d || !v || !d.kata.length) return false;
  if (d.jenis && v.jenis && d.jenis !== v.jenis) return false;
  const kv = new Set(v.kata);
  return d.kata.every((w) => kv.has(w));
}

/** Ringkasan per AM: jumlah deal, % terverifikasi, meragukan, nilai estimasi meragukan. */
export function ringkasPerAm(rows: { am: string; status: StatusKeaslian; nilai: number }[]) {
  const m = new Map<string, { am: string; total: number; terverifikasi: number; perlu_cek: number; meragukan: number; nilai_meragukan: number }>();
  for (const r of rows) {
    const x = m.get(r.am) ?? { am: r.am, total: 0, terverifikasi: 0, perlu_cek: 0, meragukan: 0, nilai_meragukan: 0 };
    x.total += 1;
    if (r.status === "TERVERIFIKASI") x.terverifikasi += 1;
    else if (r.status === "PERLU_CEK") x.perlu_cek += 1;
    else { x.meragukan += 1; x.nilai_meragukan += r.nilai; }
    m.set(r.am, x);
  }
  return [...m.values()].map((x) => ({ ...x, persen_terverifikasi: x.total ? x.terverifikasi / x.total : 0 }))
    .sort((a, b) => b.meragukan - a.meragukan || a.persen_terverifikasi - b.persen_terverifikasi);
}

// ── Kueri ────────────────────────────────────────────────────────────────

const hariIniWib = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const iso = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const normNama = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

export async function keaslianPipeline(sc: DataScope = FULL_SCOPE) {
  const sql = db();
  const hariIni = hariIniWib();
  const deals = await sql`
    SELECT d.deal_id::text, d.stage::text AS stage, (d.stage_entered_at AT TIME ZONE 'Asia/Jakarta')::date::text AS stage_masuk,
           (d.created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS dibuat,
           COALESCE(d.on_hold, false) AS on_hold, d.account_id, d.customer_name, d.facility_name, d.city,
           COALESCE(d.estimate_amount, d.estimated_value, 0)::float8 AS nilai, d.brand, d.product,
           d.am_id, COALESCE(NULLIF(mu.nama, ''), d.am_id, '(tanpa AM)') AS am, upper(btrim(COALESCE(d.cabang, mu.cabang, ''))) AS cabang
    FROM deal d
    LEFT JOIN master_user mu ON mu.am_id = d.am_id
    WHERE (d.stage::text NOT IN ('Closing-Won', 'Closing-Lost')
           OR (d.stage::text = 'Closing-Won' AND d.stage_entered_at >= now() - make_interval(days => ${ATURAN.won_jendela_hari})))
      ${scopeOnClause(sql, sc, sql`d.am_id`, sql`COALESCE(d.cabang, mu.cabang)`)}`;

  // Tautkan deal tanpa account_id lewat nama (penaut yang sama dengan #REPORT).
  const katalog = deals.some((d) => d.account_id == null) ? await katalogFaskes() : [];
  const akun = new Map<string, number | null>();
  let tautNama = 0;
  for (const d of deals) {
    if (d.account_id != null) { akun.set(String(d.deal_id), Number(d.account_id)); continue; }
    const h = tautkanFaskes(d.facility_name || d.customer_name, katalog, { kota: d.city ?? null });
    const id = h.kind === "one" ? h.id : null;
    if (id != null) tautNama += 1;
    akun.set(String(d.deal_id), id);
  }

  const ids = [...new Set([...akun.values()].filter((x): x is number => x != null))];
  const dealIds = deals.map((d) => String(d.deal_id));
  const nama = [...new Set(deals.flatMap((d) => [normNama(d.customer_name), normNama(d.facility_name)]).filter(Boolean))];
  const amIds = [...new Set(deals.map((d) => d.am_id).filter(Boolean).map(String))];
  const [kunj, faktur] = await Promise.all([
    sql`
      SELECT a.account_id, a.opportunity_id::text AS deal_id, upper(regexp_replace(btrim(COALESCE(a.customer_name, '')), '\\s+', ' ', 'g')) AS nama,
             a.am_id, a.customer_name AS tulisan,
             a.tanggal::text AS tanggal,
             (a.photo_path IS NOT NULL AND a.photo_geotag IS NOT NULL AND a.photo_geotag <> 'null'::jsonb
              AND NULLIF(a.photo_geotag->>'lat', '') IS NOT NULL) AS bukti
      FROM activity_log a
      WHERE a.tanggal >= ${hariIni}::date - 365
        AND (a.account_id = ANY(${ids}::bigint[]) OR a.opportunity_id::text = ANY(${dealIds}::text[])
             OR upper(regexp_replace(btrim(COALESCE(a.customer_name, '')), '\\s+', ' ', 'g')) = ANY(${nama}::text[])
             OR a.am_id = ANY(${amIds}::text[]))`,
    sql`
      SELECT customer_id AS account_id, array_agg(DISTINCT tanggal::text) AS tgl
      FROM accurate_invoice
      WHERE customer_id = ANY(${ids}::bigint[]) AND tanggal >= ${hariIni}::date - ${ATURAN.won_jendela_hari + ATURAN.faktur_mundur_hari}::int
      GROUP BY 1`,
  ]);
  const fakturAkun = new Map(faktur.map((f) => [Number(f.account_id), ((f.tgl as string[]) ?? []).map(iso).sort()]));

  const hasil = deals.map((d) => {
    const did = String(d.deal_id);
    const acc = akun.get(did) ?? null;
    const nm = new Set([normNama(d.customer_name), normNama(d.facility_name)].filter(Boolean));
    const teksDeal = d.facility_name || d.customer_name;
    const k = kunj.filter((v) => (acc != null && v.account_id != null && Number(v.account_id) === acc) || v.deal_id === did
        || (v.nama && nm.has(String(v.nama)))
        || (d.am_id != null && v.am_id === d.am_id && (v.account_id == null || acc == null) && kunjunganCocok(teksDeal, v.tulisan)))
      .map((v) => ({ tanggal: iso(v.tanggal), bukti: Boolean(v.bukti) }));
    const stageMasuk = d.stage_masuk ? String(d.stage_masuk) : hariIni;
    const batasFaktur = new Date(Date.parse(`${stageMasuk}T00:00:00Z`) - ATURAN.faktur_mundur_hari * 86_400_000).toISOString().slice(0, 10);
    const fk = acc != null ? (fakturAkun.get(acc) ?? []).find((t) => t >= batasFaktur) ?? null : null;
    const n = nilaiKeaslian({ stage: String(d.stage), stage_masuk: stageMasuk, on_hold: Boolean(d.on_hold), tertaut: acc != null, dibuat: d.dibuat ? String(d.dibuat) : null }, k, fk, hariIni);
    return {
      deal_id: did, stage: String(d.stage), customer: String(d.facility_name || d.customer_name || "—"),
      account_id: acc == null ? null : String(acc), tertaut_lewat: d.account_id != null ? "akun" : acc != null ? "nama" : null,
      am: String(d.am), cabang: d.cabang ? String(d.cabang) : null, nilai: Number(d.nilai) || 0,
      produk: [d.brand, d.product].filter(Boolean).join(" · ") || null,
      jumlah_kunjungan_60: k.filter((x) => hari(x.tanggal, hariIni) <= ATURAN.tanpa_kunjungan_hari).length,
      faktur_pertama: fk, ...n,
    };
  });
  const URUT: Record<StatusKeaslian, number> = { MERAGUKAN: 0, PERLU_CEK: 1, TERVERIFIKASI: 2 };
  hasil.sort((a, b) => URUT[a.status] - URUT[b.status] || b.nilai - a.nilai);

  const hitung = (s: StatusKeaslian, won?: boolean) => hasil.filter((h) => h.status === s && (won == null || (h.stage === "Closing-Won") === won)).length;
  return {
    hari_ini: hariIni, aturan: { ...ATURAN, batas_tahap: BATAS_TAHAP },
    ringkas: {
      total: hasil.length, terbuka: hasil.filter((h) => h.stage !== "Closing-Won").length, won: hasil.filter((h) => h.stage === "Closing-Won").length,
      meragukan: hitung("MERAGUKAN"), perlu_cek: hitung("PERLU_CEK"), terverifikasi: hitung("TERVERIFIKASI"),
      nilai_meragukan: hasil.filter((h) => h.status === "MERAGUKAN").reduce((s, h) => s + h.nilai, 0),
      tertaut_nama: tautNama, tak_tertaut: hasil.filter((h) => h.account_id == null).length,
    },
    per_am: ringkasPerAm(hasil.map((h) => ({ am: h.am, status: h.status, nilai: h.nilai }))),
    deals: hasil,
  };
}

