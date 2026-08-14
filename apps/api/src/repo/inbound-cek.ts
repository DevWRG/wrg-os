// Handler WA `#CEK <nama customer>` (QW3) — cek pre-delivery singkat: SO & SJ
// terbaru dari mirror Accurate (accurate_sales_order/accurate_delivery_order),
// match nama via pg_trgm similarity (pola sama dgn resolveActivityLinks di
// inbound.ts). TTF (Surat Terima) belum punya sumber data/menu input → baris
// placeholder statis (keputusan scope QW3), bukan hasil query.

import { db } from "../db.js";
import { stripInvisible } from "../parsers/dailyplan.js";

const CEK_LINE = /^\s*#\s*cek\b/i;
// Threshold sejajar fuzzy match plan/report (0.3, bukan ACCOUNT_MATCH 0.45) —
// customer_name di SO/SJ teks bebas dari Accurate, bukan account_id permanen.
const CEK_MATCH = 0.3;

function extractCustomer(body: string | null): string | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    if (CEK_LINE.test(line)) return line.replace(CEK_LINE, "").trim();
  }
  return null;
}

export function detectCek(body: string | null): boolean {
  return extractCustomer(body) !== null;
}

export async function handleCekQuery(body: string | null): Promise<string> {
  const q = extractCustomer(body);
  if (!q) return "Ketik: #CEK [nama customer]";

  const sql = db();
  const [so] = await sql`
    SELECT number, trans_date::text AS trans_date, status, customer_name,
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

  const matchedName = String((so ?? sj)!.customer_name ?? q);
  const soLine = so ? `${so.number ?? "-"} (${so.trans_date ?? "-"}) — ${so.status ?? "-"}` : "Belum ada SO tercatat";
  const sjLine = sj ? `${sj.number ?? "-"} (${sj.trans_date ?? "-"}) — ${sj.status ?? "-"}` : "Belum ada SJ tercatat";
  return `🔎 *Cek Pengiriman — ${matchedName}*\nSO: ${soLine}\nSJ: ${sjLine}\nTTF (Surat Terima): belum ada konfirmasi`;
}
