"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Kinerja Saya — halaman ber-scope ke akun login (AM=data sendiri, HoD=tim,
// admin=semua) via resolveScope di backend. 2 tab: Revenue & AR.
// Revenue REUSE /sales-analytics/overview (shape "am") + /per-customer (top customer),
// keduanya sudah ber-scope. AR pakai /sales-analytics/my-ar (aging ber-scope).

// ── Format Rupiah ──────────────────────────────────────────────────
const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number) => rp.format(n || 0);
const fmtRpShort = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)}M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)}jt`;
  return fmtRp(v);
};
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

const MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTH_ID[Number(m) - 1] ?? m} ${String(y).slice(2)}`;
};

// ── Tipe ───────────────────────────────────────────────────────────
interface TrendPt { date: string; revenue: number; orders: number }
interface OverviewAm {
  scope: "am";
  range: { from: string; to: string };
  kpi: { revenue: number; orders: number; customers: number; target: number | null; achievement_pct: number | null };
  trend: TrendPt[];
}
interface OverviewAll { scope: "all"; kpi: { revenue: number; orders: number; customers: number }; trend: TrendPt[] }
type OverviewResult = OverviewAm | OverviewAll;

interface CustRow { id: string; name: string; total: number; invoices: number }
interface PerCustomer { scope: string; customers: CustRow[] }

interface ArBucket { bucket: string; label: string; count: number; total: number }
interface ArTopCustomer {
  id: string; name: string; cabang: string | null; am: string | null;
  total: number; invoices: number; max_overdue: number; priority: string;
}
interface MyAr {
  scope: string;
  total_outstanding: number;
  overdue_outstanding: number;
  total_invoices: number;
  total_customers: number;
  buckets: ArBucket[];
  top_customers: ArTopCustomer[];
}

type TabKey = "revenue" | "ar";
const TABS: { key: TabKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "ar", label: "AR (Piutang)" },
];

// Palet bucket aging: hijau (belum) → merah (>90 hari). Sama di light & dark.
const AGING_COLORS: Record<string, string> = {
  current: "#0d9488",
  "1-30": "#38bdf8",
  "31-60": "#f59e0b",
  "61-90": "#f97316",
  "90+": "#dc2626",
};
const PRIORITY_STYLE: Record<string, string> = {
  KRITIS: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  TINGGI: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  SEDANG: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  RENDAH: "bg-muted text-muted-foreground",
};

// ── Sub-komponen ───────────────────────────────────────────────────
function Kpi({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {delta != null && (
          <div className={`text-xs font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs bulan lalu
          </div>
        )}
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ── Revenue tab ────────────────────────────────────────────────────
function RevenueTab({ overview, cust }: { overview: OverviewResult | null; cust: PerCustomer | null }) {
  const monthly = useMemo(() => {
    const trend = overview?.trend ?? [];
    const map = new Map<string, number>();
    for (const p of trend) {
      const ym = String(p.date).slice(0, 7);
      map.set(ym, (map.get(ym) ?? 0) + Number(p.revenue || 0));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, revenue]) => ({ ym, label: monthLabel(ym), revenue }));
  }, [overview]);

  if (!overview) return <div className="text-muted-foreground text-sm">Tidak ada data revenue.</div>;

  const total = overview.kpi.revenue;
  const orders = overview.kpi.orders;
  const bulanIni = monthly.length ? monthly[monthly.length - 1] : null;
  const bulanLalu = monthly.length > 1 ? monthly[monthly.length - 2] : null;
  const delta = bulanIni && bulanLalu && bulanLalu.revenue > 0
    ? Math.round(((bulanIni.revenue - bulanLalu.revenue) / bulanLalu.revenue) * 1000) / 10
    : null;
  const achievement = overview.scope === "am" ? overview.kpi.achievement_pct : null;
  const topCust = (cust?.customers ?? []).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total Revenue" value={fmtRp(total)} sub="periode berjalan (YTD)" />
        <Kpi label="Bulan Ini" value={fmtRp(bulanIni?.revenue ?? 0)} delta={delta} sub={bulanIni ? bulanIni.label : undefined} />
        <Kpi label="Faktur" value={String(orders)} />
        <Kpi label="Achievement" value={fmtPct(achievement)} sub={achievement == null ? "target tidak tersedia" : "vs target tahunan"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tren Revenue Bulanan</CardTitle></CardHeader>
        <CardContent>
          {monthly.length === 0 ? (
            <div className="text-muted-foreground text-sm">Belum ada data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis tickFormatter={(v) => fmtRpShort(Number(v))} fontSize={11} width={70} />
                <Tooltip formatter={(v) => fmtRp(Number(v))} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Bar dataKey="revenue" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Top Customer (Revenue)</CardTitle></CardHeader>
        <CardContent>
          {topCust.length === 0 ? (
            <div className="text-muted-foreground text-sm">Tidak ada data customer.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-xs uppercase tracking-wide">
                    <th className="px-2 py-2 text-left font-semibold">#</th>
                    <th className="px-2 py-2 text-left font-semibold">Customer</th>
                    <th className="px-2 py-2 text-right font-semibold">Faktur</th>
                    <th className="px-2 py-2 text-right font-semibold">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topCust.map((r, i) => (
                    <tr key={r.id} className="border-border/60 hover:bg-muted/40 border-b">
                      <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{r.name}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.invoices}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{fmtRp(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── AR tab ─────────────────────────────────────────────────────────
function ArTab({ ar }: { ar: MyAr | null }) {
  if (!ar) return <div className="text-muted-foreground text-sm">Tidak ada data piutang.</div>;
  const chart = ar.buckets.map((b) => ({ ...b }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total Outstanding" value={fmtRp(ar.total_outstanding)} sub="sisa tagihan (net)" />
        <Kpi label="Jatuh Tempo" value={fmtRp(ar.overdue_outstanding)} sub="di luar belum jatuh tempo" />
        <Kpi label="Faktur" value={String(ar.total_invoices)} />
        <Kpi label="Customer" value={String(ar.total_customers)} sub="punya piutang" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Umur Piutang (Aging)</CardTitle></CardHeader>
        <CardContent>
          {chart.every((b) => b.total === 0) ? (
            <div className="text-muted-foreground text-sm">Belum ada piutang.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis tickFormatter={(v) => fmtRpShort(Number(v))} fontSize={11} width={70} />
                <Tooltip
                  formatter={(v) => fmtRp(Number(v))}
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chart.map((b) => <Cell key={b.bucket} fill={AGING_COLORS[b.bucket] ?? "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
            {chart.map((b) => (
              <span key={b.bucket} className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: AGING_COLORS[b.bucket] ?? "#64748b" }} />
                {b.label}: {b.count} faktur
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Top Customer Menunggak</CardTitle></CardHeader>
        <CardContent>
          {ar.top_customers.length === 0 ? (
            <div className="text-muted-foreground text-sm">Tidak ada customer menunggak.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-xs uppercase tracking-wide">
                    <th className="px-2 py-2 text-left font-semibold">#</th>
                    <th className="px-2 py-2 text-left font-semibold">Customer</th>
                    <th className="px-2 py-2 text-left font-semibold">Cabang</th>
                    <th className="px-2 py-2 text-right font-semibold">Faktur</th>
                    <th className="px-2 py-2 text-right font-semibold">Maks Hari</th>
                    <th className="px-2 py-2 text-left font-semibold">Prioritas</th>
                    <th className="px-2 py-2 text-right font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {ar.top_customers.map((r, i) => (
                    <tr key={r.id} className="border-border/60 hover:bg-muted/40 border-b">
                      <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{r.name}</td>
                      <td className="px-2 py-2">{r.cabang ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.invoices}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.max_overdue}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[r.priority] ?? "bg-muted text-muted-foreground"}`}>
                          {r.priority}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{fmtRp(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────
export function MySalesView() {
  const [tab, setTab] = useState<TabKey>("revenue");
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [cust, setCust] = useState<PerCustomer | null>(null);
  const [ar, setAr] = useState<MyAr | null>(null);
  const [loaded, setLoaded] = useState<Record<TabKey, boolean>>({ revenue: false, ar: false });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (loaded[tab]) return;
    let alive = true;
    const run = async () => {
      setLoading(true);
      setErr("");
      try {
        if (tab === "revenue") {
          const [oRes, cRes] = await Promise.all([
            fetch("/api/sales-analytics/overview"),
            fetch("/api/sales-analytics/per-customer"),
          ]);
          const oData = await oRes.json();
          if (!oRes.ok) throw new Error(String(oData.error ?? `HTTP ${oRes.status}`));
          if (alive) setOverview(oData as OverviewResult);
          if (cRes.ok) {
            const cData = await cRes.json();
            if (alive) setCust(cData as PerCustomer);
          }
        } else {
          const res = await fetch("/api/sales-analytics/my-ar");
          const data = await res.json();
          if (!res.ok) throw new Error(String(data.error ?? `HTTP ${res.status}`));
          if (alive) setAr(data as MyAr);
        }
        if (alive) setLoaded((s) => ({ ...s, [tab]: true }));
      } catch (e) {
        if (alive) setErr((e as Error).message || "gagal memuat data");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [tab, loaded]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">{err}</div>}
      {loading && <div className="text-muted-foreground text-sm">Memuat…</div>}

      {tab === "revenue" && <RevenueTab overview={overview} cust={cust} />}
      {tab === "ar" && <ArTab ar={ar} />}
    </div>
  );
}
