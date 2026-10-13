// F72 E-Catalog Recovery Watch — tab "E-Catalog" di Sales Analytics.
//
// PENANDA E-KATALOG = AWALAN NOMOR FAKTUR "PJE" — BUKAN label pengadaan ECAT.
// Diukur di prod 13 Okt 2026: label ECAT (detailItem.charField1) berhenti dipakai
// sejak Jun 2026 (RUTIN juga diganti REGULAR) — keputusan user: "tim memang
// berhenti melabeli ECAT". Faktur PJE tetap jalan stabil (Jun–Sep 2026: 53–64
// faktur, 42–48 faskes per bulan), sementara yang berlabel ECAT 0–7. Memakai label
// akan melaporkan hampir semua faskes "kolaps" padahal transaksinya masih ada.
// 492 dari 510 faktur ECAT (Jun 2025+) memang bernomor PJE-…; SJ-nya SJE-….
//
// Keputusan user 13 Okt:
//   • status bertingkat dari hari sejak faktur PJE terakhir: aktif ≤30 ·
//     waspada 31–60 · berisiko 61–90 · kolaps >90 — atas faskes yang pernah
//     beli via e-katalog dalam 18 bulan terakhir;
//   • faskes yang berhenti di e-katalog tapi MASIH beli lewat jalur lain
//     (REGULAR/KSO) ditandai terpisah "pindah jalur" — pelanggannya tidak hilang;
//   • tempatnya tab di Sales Analytics (scope AM/HoD/admin sama dengan tab lain).
//
// Musiman: e-katalog memuncak di Q4 (siklus anggaran faskes pemerintah — Okt
// 2025 Rp 8,2 M, Jan 2026 nyaris nol). Karena itu tren bulanan menampilkan
// pembanding bulan yang sama tahun lalu, bukan bulan sebelumnya.
//
// Revenue = netto (total − PPN), sama dengan tab-tab lain Sales Analytics.
// AM = AM dari faktur PJE TERAKHIR faskes itu (joinAmFromSalesman), dan scope
// AM/HoD menyaring lewat AM tersebut.

import { db } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { scopeAccurateClause, type DataScope } from "./access-scope.js";

export const PREFIX_ECATALOG = "PJE";
export const JENDELA_BULAN = 18;
export type StatusEcat = "aktif" | "waspada" | "berisiko" | "kolaps" | "pindah_jalur";
export const AMBANG = { aktif: 30, waspada: 60, berisiko: 90 } as const;
/** "Pindah jalur" = PJE sudah lewat ambang waspada TAPI ada faktur non-PJE dalam 60 hari terakhir. */
export const JALUR_LAIN_HARI = 60;

/** Fungsi murni (diuji): status satu faskes. */
export function statusEcat(hariSejakPje: number, hariSejakNonPje: number | null): StatusEcat {
  if (hariSejakPje > AMBANG.waspada && hariSejakNonPje != null && hariSejakNonPje <= JALUR_LAIN_HARI && hariSejakNonPje < hariSejakPje) {
    return "pindah_jalur";
  }
  if (hariSejakPje <= AMBANG.aktif) return "aktif";
  if (hariSejakPje <= AMBANG.waspada) return "waspada";
  if (hariSejakPje <= AMBANG.berisiko) return "berisiko";
  return "kolaps";
}

export interface FaskesEcat {
  customer_id: string; nama: string;
  pje_terakhir: string; hari_sejak_pje: number; pje_faktur: number; pje_netto: number; pje_nomor_terakhir: string;
  non_pje_terakhir: string | null; hari_sejak_non_pje: number | null; non_pje_netto_90h: number;
  am_id: string | null; am_nama: string | null; cabang: string | null;
  pje_tahun_lalu_netto: number; // periode yang sama tahun lalu (90 hari ke depan dari hari ini −1 tahun)
  status: StatusEcat;
}

export interface BulanEcat { bulan: string; faktur: number; faskes: number; netto: number; netto_tahun_lalu: number }

export async function ecatalogWatch(scope: DataScope): Promise<{
  prefix: string; jendela_bulan: number; ringkasan: Record<StatusEcat, number>; total_faskes: number;
  faskes: FaskesEcat[]; tren: BulanEcat[];
}> {
  const sql = db();
  const pje = `${PREFIX_ECATALOG}%`;
  // Faktur PJE per faskes dalam jendela; AM = AM faktur PJE terakhir (DISTINCT ON).
  const rows = await sql`
    WITH pje AS (
      SELECT ai.customer_id, ai.tanggal, ai.number, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS netto,
             mu.am_id, NULLIF(mu.nama,'') AS am_nama, NULLIF(mu.cabang,'') AS cabang
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.customer_id IS NOT NULL AND ai.number ILIKE ${pje}
        AND ai.tanggal >= (CURRENT_DATE - make_interval(months => ${JENDELA_BULAN}))
    ),
    terakhir AS (
      SELECT DISTINCT ON (customer_id) customer_id, tanggal, number, am_id, am_nama, cabang
      FROM pje ORDER BY customer_id, tanggal DESC, number DESC
    ),
    agg AS (
      SELECT customer_id, count(*)::int AS faktur, sum(netto)::float8 AS netto FROM pje GROUP BY customer_id
    )
    SELECT t.customer_id::text, COALESCE(NULLIF(ac.name,''), 'Customer #' || t.customer_id::text) AS nama,
           t.tanggal::text AS pje_terakhir, (CURRENT_DATE - t.tanggal)::int AS hari_sejak_pje,
           a.faktur, a.netto, t.number AS pje_nomor_terakhir, t.am_id, t.am_nama, t.cabang,
           np.terakhir::text AS non_pje_terakhir, (CURRENT_DATE - np.terakhir)::int AS hari_sejak_non_pje,
           COALESCE(np.netto_90h, 0)::float8 AS non_pje_netto_90h,
           COALESCE(ly.netto, 0)::float8 AS pje_tahun_lalu_netto
    FROM terakhir t
    JOIN agg a ON a.customer_id = t.customer_id
    LEFT JOIN accurate_customer ac ON ac.id = t.customer_id
    LEFT JOIN LATERAL (
      SELECT max(x.tanggal) AS terakhir,
             sum(x.total - COALESCE(x.tax_amount,0)) FILTER (WHERE x.tanggal > CURRENT_DATE - 90) AS netto_90h
      FROM accurate_invoice x
      WHERE x.customer_id = t.customer_id AND x.number NOT ILIKE ${pje}
        AND x.tanggal >= (CURRENT_DATE - make_interval(months => ${JENDELA_BULAN}))
    ) np ON true
    LEFT JOIN LATERAL (
      SELECT sum(y.total - COALESCE(y.tax_amount,0)) AS netto
      FROM accurate_invoice y
      WHERE y.customer_id = t.customer_id AND y.number ILIKE ${pje}
        AND y.tanggal >= (CURRENT_DATE - interval '1 year') - interval '90 days'
        AND y.tanggal <  (CURRENT_DATE - interval '1 year') + interval '90 days'
    ) ly ON true
    -- scope: lewat AM faktur PJE terakhir. scopeAccurateClause butuh alias ai/mu;
    -- dibungkus ulang sbg subquery supaya aturannya tetap satu definisi.
    WHERE EXISTS (
      SELECT 1 FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.customer_id = t.customer_id AND ai.number = t.number
        ${scopeAccurateClause(sql, scope)}
    )
    ORDER BY (CURRENT_DATE - t.tanggal) ASC`;

  const faskes: FaskesEcat[] = rows.map((r) => {
    const hp = Number(r.hari_sejak_pje);
    const hn = r.hari_sejak_non_pje == null ? null : Number(r.hari_sejak_non_pje);
    return {
      customer_id: String(r.customer_id), nama: String(r.nama),
      pje_terakhir: String(r.pje_terakhir), hari_sejak_pje: hp, pje_faktur: Number(r.faktur), pje_netto: Number(r.netto),
      pje_nomor_terakhir: String(r.pje_nomor_terakhir),
      non_pje_terakhir: r.non_pje_terakhir ? String(r.non_pje_terakhir) : null, hari_sejak_non_pje: hn,
      non_pje_netto_90h: Number(r.non_pje_netto_90h),
      am_id: r.am_id ? String(r.am_id) : null, am_nama: r.am_nama ? String(r.am_nama) : null, cabang: r.cabang ? String(r.cabang) : null,
      pje_tahun_lalu_netto: Number(r.pje_tahun_lalu_netto),
      status: statusEcat(hp, hn),
    };
  });

  const ringkasan = { aktif: 0, waspada: 0, berisiko: 0, kolaps: 0, pindah_jalur: 0 } as Record<StatusEcat, number>;
  for (const f of faskes) ringkasan[f.status] += 1;

  // Tren bulanan PJE (ber-scope per faktur) + pembanding bulan yang sama tahun lalu.
  const tr = await sql`
    WITH b AS (
      SELECT to_char(ai.tanggal, 'YYYY-MM') AS bulan, ai.customer_id, (ai.total - COALESCE(ai.tax_amount,0))::float8 AS netto
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.number ILIKE ${pje}
        AND ai.tanggal >= date_trunc('month', CURRENT_DATE) - make_interval(months => ${JENDELA_BULAN + 12})
        ${scopeAccurateClause(sql, scope)}
    )
    SELECT bulan, count(*)::int AS faktur, count(DISTINCT customer_id)::int AS faskes, sum(netto)::float8 AS netto
    FROM b GROUP BY bulan ORDER BY bulan`;
  const perBulan = new Map(tr.map((r) => [String(r.bulan), { faktur: Number(r.faktur), faskes: Number(r.faskes), netto: Number(r.netto) }]));
  const tren = susunTren(perBulan, new Date(), JENDELA_BULAN);

  return { prefix: PREFIX_ECATALOG, jendela_bulan: JENDELA_BULAN, ringkasan, total_faskes: faskes.length, faskes, tren };
}

/** Fungsi murni (diuji): deret N bulan terakhir (termasuk bulan berjalan) + netto bulan yang sama tahun lalu; bulan kosong = 0. */
export function susunTren(perBulan: Map<string, { faktur: number; faskes: number; netto: number }>, kini: Date, n: number): BulanEcat[] {
  const out: BulanEcat[] = [];
  const wib = new Date(kini.getTime() + 7 * 3600 * 1000);
  const y0 = wib.getUTCFullYear();
  const m0 = wib.getUTCMonth();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y0, m0 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const lalu = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)).toISOString().slice(0, 7);
    const v = perBulan.get(key);
    out.push({ bulan: key, faktur: v?.faktur ?? 0, faskes: v?.faskes ?? 0, netto: v?.netto ?? 0, netto_tahun_lalu: perBulan.get(lalu)?.netto ?? 0 });
  }
  return out;
}
