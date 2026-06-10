import { db } from "../db.js";

// D1 — intelijen produk diturunkan dari deal.product_ids (belum ada katalog
// produk; intelijen di-key oleh kode produk). Deterministik, read-only — dasar
// agen A7 (Product Intelligence, R1/LOW).

export interface ProductIntel {
  product_id: string;
  deal_count: number;
  total_value: number;
  open_value: number;
  won: number;
  lost: number;
  win_rate: number | null; // won / (won + lost), null bila belum ada keputusan
}

export async function getProductIntelligence(limit = 100): Promise<ProductIntel[]> {
  const sql = db();
  const rows = await sql`
    SELECT pid AS product_id,
           count(*)::int AS deal_count,
           coalesce(sum(d.estimated_value), 0) AS total_value,
           coalesce(sum(d.estimated_value)
             FILTER (WHERE d.stage NOT IN ('Deal', 'MOU', 'Lose')), 0) AS open_value,
           count(*) FILTER (WHERE d.stage IN ('Deal', 'MOU'))::int AS won,
           count(*) FILTER (WHERE d.stage = 'Lose')::int AS lost
    FROM deal d
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(d.product_ids, '[]'::jsonb)) AS pid
    GROUP BY pid
    ORDER BY total_value DESC, deal_count DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    const won = Number(r.won);
    const lost = Number(r.lost);
    const decided = won + lost;
    return {
      product_id: String(r.product_id),
      deal_count: Number(r.deal_count),
      total_value: Number(r.total_value),
      open_value: Number(r.open_value),
      won,
      lost,
      win_rate: decided > 0 ? Math.round((won / decided) * 100) / 100 : null,
    };
  });
}
