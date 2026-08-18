// Handler WA `#CEK CUSTOMER <nama customer>` (QW3) — cek pre-delivery singkat
// SO+SJ+TTF dalam 1 balasan, dari mirror Accurate (accurate_sales_order/
// accurate_delivery_order), match nama via pg_trgm similarity (pola sama dgn
// resolveActivityLinks di inbound.ts). AM/salesman via live call ke Accurate
// (getSalesOrderItems) — kredensial tak tersedia (mis. dev lokal) → AM
// di-skip, balasan SO/SJ tetap jalan. TTF (Surat Terima) belum punya sumber
// data/menu input → baris placeholder statis (keputusan scope QW3), bukan
// hasil query. Kurir/no. resi/tanggal TERIMA SENGAJA belum ditampilkan —
// tidak ada sumbernya di Accurate maupun tabel lain yg terhubung ke SO/SJ
// (lihat TECHNICAL.md).
//
// Sub-command lain dari spec asli (`#CEK SO <nomor>`, `#CEK SJ <nomor>`,
// `#CEK FAKTUR <nomor>`) BELUM diimplementasi — di luar scope yang diminta
// (hanya varian CUSTOMER).

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";
import { fmtRp } from "./inbound-sales-analytics.js";
import { getSalesOrderItems } from "./accurateSync.js";

const CEK_CUSTOMER_LINE = /^\s*#\s*cek\s+customer\b/i;
// Threshold sejajar fuzzy match plan/report (0.3, bukan ACCOUNT_MATCH 0.45) —
// customer_name di SO/SJ teks bebas dari Accurate, bukan account_id permanen.
const CEK_MATCH = 0.3;

function extractCustomer(body: string | null): string | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    if (CEK_CUSTOMER_LINE.test(line)) return line.replace(CEK_CUSTOMER_LINE, "").trim();
  }
  return null;
}

export function detectCek(body: string | null): boolean {
  return extractCustomer(body) !== null;
}

export async function handleCekQuery(body: string | null): Promise<string> {
  const q = extractCustomer(body);
  if (!q) return "Ketik: #CEK CUSTOMER [nama customer]";

  const sql = db();
  const [so] = await sql`
    SELECT id::text AS id, number, trans_date::text AS trans_date, status, customer_name, total_amount,
           similarity(customer_name, ${q}) AS score
    FROM accurate_sales_order
    WHERE similarity(customer_name, ${q}) > ${CEK_MATCH}
    ORDER BY score DESC, trans_date DESC LIMIT 1
  `;
  const [sj] = await sql`
    SELECT number, trans_date::text AS trans_date, status, customer_name,
           similarity(customer_name, ${q}) AS score
    FROM accurate_delivery_order
    WHERE similarity(customer_name, ${q}) > ${CEK_MATCH}
    ORDER BY score DESC, trans_date DESC LIMIT 1
  `;
  if (!so && !sj) return `Customer "${q}" tidak ditemukan di data SO/SJ.`;

  // AM (salesman) — live call ke Accurate detail.do (bukan mirror lokal, sumber
  // satu-satunya utk nama AM per-SO). Gagal (kredensial tak tersedia/lokal dev,
  // atau error API) → AM cukup di-skip, jangan sampai gagalkan balasan SO/SJ.
  let amLine = "";
  if (so) {
    try {
      const det = await getSalesOrderItems(Number(so.id));
      const salesman = det.ok ? det.summary?.salesman : null;
      if (salesman) amLine = ` · AM: ${salesman}`;
    } catch {
      /* live call gagal (mis. kredensial/lokal dev) → AM di-skip, bukan error */
    }
  }

  const matchedName = String((so ?? sj)!.customer_name ?? q);
  const soBlock = so
    ? `📋 SO ${so.number ?? "-"} · ${fmtRp(Number(so.total_amount ?? 0))}\n   Status: ${so.status ?? "-"}${amLine}`
    : "📋 Belum ada SO tercatat";
  const sjBlock = sj
    ? `→ SJ ${sj.number ?? "-"} (${sj.trans_date ?? "-"})\n   Status: ${sj.status ?? "-"}`
    : "→ Belum ada SJ tercatat";
  return `🔎 *Cek Customer — ${matchedName}*\n\n${soBlock}\n\n${sjBlock}\n\n🚩 TTF belum received`;
}
