// Handler WA `#SALES` — jawab query analitik singkat via WA. Dipanggil dari
// inbound.ts (kind === "sales"). Scope: pengirim AM → data sendiri; lainnya →
// semua. Reuse repo sales-analytics.ts. Return TEKS balasan (bukan kirim).

import { parseSalesQuery } from "../parsers/sales-query.js";
import { analyticsOverview, analyticsPerAm, analyticsPerCabang } from "./sales-analytics.js";
import type { DataScope } from "./access-scope.js";

const isAm = (r?: string | null): boolean => (r ?? "").trim().toUpperCase() === "AM";

function fmtRp(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}
const pctStr = (n: number | null | undefined): string => (n == null ? "—" : `${n}%`);

export async function handleSalesAnalyticsQuery(
  body: string,
  sender: { am_id: string; nama: string | null; role: string | null },
): Promise<string> {
  const q = parseSalesQuery(body);
  const scope: DataScope = { userId: null, amOnly: isAm(sender.role), amId: sender.am_id, cabang: null, superuser: false };
  const head = `📊 *Sales — ${q.periodLabel}*`;

  if (q.scope === "per_cabang") {
    const d = await analyticsPerCabang(q.from, q.to, scope);
    if (!d.rows.length) return `${head}\nTidak ada data.`;
    const lines = d.rows.slice(0, 8).map((r, i) => `${i + 1}. ${r.cabang} (${r.region}) — ${fmtRp(r.total)}${r.achievement_pct != null ? ` · ${pctStr(r.achievement_pct)}` : ""}`);
    return `${head} · Per Cabang\n${lines.join("\n")}`;
  }

  if (q.scope === "per_am") {
    const d = await analyticsPerAm(q.from, q.to, scope);
    if (!d.rows.length) return `${head}\nTidak ada data.`;
    const lines = d.rows.slice(0, 5).map((r) => `${r.rank}. ${r.nama ?? "—"}${r.self ? " (Anda)" : ""} — ${fmtRp(r.total)}${r.achievement_pct != null ? ` · ${pctStr(r.achievement_pct)}` : ""}`);
    return `${head} · Top AM\n${lines.join("\n")}`;
  }

  // overview
  const d = await analyticsOverview(q.from, q.to, scope);
  if (d.scope === "am") {
    return `${head} · Anda (${sender.nama ?? sender.am_id})\nRevenue: ${fmtRp(d.kpi.revenue)}\nFaktur: ${d.kpi.orders} · Customer: ${d.kpi.customers}\nAchievement: ${pctStr(d.kpi.achievement_pct)}`;
  }
  return `${head}\nRevenue: ${fmtRp(d.kpi.revenue)}\nFaktur: ${d.kpi.orders} · Customer: ${d.kpi.customers}\nAR outstanding: ${fmtRp(d.kpi.ar_outstanding)}\n\nKetik: #SALES bulan_ini per_cabang  /  per_am`;
}
