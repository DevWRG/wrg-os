"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BAR_FILL, RESULT_FILL, stageFill, stageInk } from "@/lib/pipeline-viz";
import type { PipelineDeal } from "./pipeline-board";

// Infografis board /pipeline. Sumbernya `deals` = daftar yang SUDAH difilter
// toolbar board, jadi tiap grafik otomatis ikut filter (Kategori/Cabang/HOD/AM/
// Brand/Coop/Tahun + pencarian) tanpa state kedua — sama seperti Export Excel
// yang juga makan `filtered`. Jangan pernah dialihkan ke `allDeals`: begitu
// grafik dan kartu di bawahnya beda basis, angkanya bohong tanpa suara.

const rpC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${v.toLocaleString("id-ID")}`;
};
// Tick sumbu: tanpa spasi ("Rp 160jt"), kalau pakai spasi label 3 kata pecah dua
// baris di sumbu Y yang sempit dan ikut memotong tick sebelahnya.
const rpTick = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)}M`;
  if (Math.abs(v) >= 1e6) return `Rp ${Math.round(v / 1e6)}jt`;
  if (Math.abs(v) >= 1e3) return `Rp ${Math.round(v / 1e3)}rb`;
  return `Rp ${v}`;
};
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const STAGE_SHORT: Record<string, string> = {
  Prospecting: "Prospek", Presentation: "Presentasi", Quotation: "Penawaran",
  Negotiation: "Negosiasi", Closing: "Closing", "Closing-Won": "Won", "Closing-Lost": "Lost",
};
const CLOSED = { won: "Closing-Won", lost: "Closing-Lost" };

interface Row { key: string; label: string; count: number; value: number; weighted: number }

// Agregasi generik per dimensi; baris tanpa nilai dimensi dibuang (bukan
// dijadikan "" yang tampil sebagai bar tanpa nama).
function groupBy(deals: PipelineDeal[], pick: (d: PipelineDeal) => string | null): Row[] {
  const m = new Map<string, Row>();
  for (const d of deals) {
    const k = pick(d);
    if (!k) continue;
    const r = m.get(k) ?? { key: k, label: k, count: 0, value: 0, weighted: 0 };
    r.count += 1;
    r.value += d.estimate_amount ?? 0;
    r.weighted += d.weighted;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.weighted - a.weighted);
}

// Top-N + sisanya dilipat jadi satu baris "Lainnya" — jangan dipotong diam-diam,
// nanti total bar tak sama dengan total kartu KPI di atasnya.
function topN(rows: Row[], n: number): Row[] {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n);
  return [
    ...rows.slice(0, n),
    {
      key: "__rest__",
      label: `Lainnya (${rest.length})`,
      count: rest.reduce((a, r) => a + r.count, 0),
      value: rest.reduce((a, r) => a + r.value, 0),
      weighted: rest.reduce((a, r) => a + r.weighted, 0),
    },
  ];
}

function RowTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string | number;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold">{label ?? p.label}</div>
      <div>Jumlah deal: <span className="font-medium tabular-nums">{p.count}</span></div>
      <div>Perkiraan nilai: <span className="font-medium tabular-nums">{rpC(p.value)}</span></div>
      <div>Nilai × peluang: <span className="font-medium tabular-nums">{rpC(p.weighted)}</span></div>
    </div>
  );
}

function Panel({ title, hint, empty, children, wide }: {
  title: string;
  hint?: string;
  empty?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Card className={wide ? "lg:col-span-2" : undefined}>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {empty ? <div className="text-muted-foreground py-6 text-center text-sm">Belum ada data pada filter ini.</div> : children}
        {hint && !empty && <div className="text-muted-foreground mt-2 text-xs leading-snug">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// Bar horizontal satu-hue: identitas dari label sumbu, panjang bar = besaran.
function HBar({ rows, height }: { rows: Row[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(140, rows.length * 30)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 44, top: 4, bottom: 4 }} barCategoryGap={4}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => rpTick(Number(v))} fontSize={10} />
        <YAxis type="category" dataKey="label" fontSize={10} width={132} tickMargin={4} />
        <Tooltip content={<RowTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        {/* maxBarSize: tanpa ini satu-dua kategori bikin bar melebar setinggi
            seluruh plot — terbaca seperti blok warna, bukan bar. */}
        <Bar dataKey="weighted" fill={BAR_FILL} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PipelineInsights({ deals, stages }: { deals: PipelineDeal[]; stages: string[] }) {
  const [open, setOpen] = useState(true);

  const ins = useMemo(() => {
    const byStage = new Map<string, Row>();
    for (const s of stages) byStage.set(s, { key: s, label: STAGE_SHORT[s] ?? s, count: 0, value: 0, weighted: 0 });
    for (const d of deals) {
      const r = byStage.get(d.stage);
      if (!r) continue;
      r.count += 1;
      r.value += d.estimate_amount ?? 0;
      r.weighted += d.weighted;
    }
    const funnel = stages.map((s) => byStage.get(s)!);

    const won = byStage.get(CLOSED.won)?.count ?? 0;
    const lost = byStage.get(CLOSED.lost)?.count ?? 0;
    const openDeals = deals.filter((d) => d.stage !== CLOSED.won && d.stage !== CLOSED.lost);
    const decided = won + lost;

    // Estimasi closing: hanya deal yang masih jalan (Won/Lost sudah diputus,
    // memasukkannya bikin "beban bulan depan" kelihatan lebih besar dari nyata).
    const etaMap = new Map<string, Row>();
    let noEta = 0;
    for (const d of openDeals) {
      if (d.purchase_year == null || d.purchase_month == null || d.purchase_month < 1 || d.purchase_month > 12) { noEta += 1; continue; }
      const k = `${d.purchase_year}-${String(d.purchase_month).padStart(2, "0")}`;
      const r = etaMap.get(k) ?? { key: k, label: `${MONTH_SHORT[d.purchase_month - 1]} ${String(d.purchase_year).slice(-2)}`, count: 0, value: 0, weighted: 0 };
      r.count += 1;
      r.value += d.estimate_amount ?? 0;
      r.weighted += d.weighted;
      etaMap.set(k, r);
    }
    const eta = [...etaMap.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(0, 12);

    return {
      funnel,
      brands: topN(groupBy(openDeals, (d) => d.brand), 8),
      ams: topN(groupBy(openDeals, (d) => d.am_name), 8),
      result: [
        { key: "won", label: "Won", count: won, value: 0, weighted: 0 },
        { key: "lost", label: "Lost", count: lost, value: 0, weighted: 0 },
        { key: "open", label: "Masih jalan", count: openDeals.length, value: 0, weighted: 0 },
      ].filter((r) => r.count > 0),
      won, lost, openCount: openDeals.length,
      winRate: decided > 0 ? won / decided : null,
      openWeighted: openDeals.reduce((a, d) => a + d.weighted, 0),
      eta, noEta,
    };
  }, [deals, stages]);

  const maxFunnel = Math.max(1, ...ins.funnel.map((r) => r.count));

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          Infografis Pipeline
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {deals.length} deal terpilih · mengikuti filter aktif
          </span>
        </div>
        <button onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground text-xs underline">
          {open ? "sembunyikan" : "tampilkan"}
        </button>
      </div>

      {open && (deals.length === 0 ? (
        <div className="text-muted-foreground py-6 text-center text-sm">
          Tidak ada deal pada filter ini — infografis ikut kosong.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {/* Sebaran per tahap. BUKAN funnel konversi: ini potret posisi deal saat
              ini, bukan kohort yang diikuti antar tahap — persentase "konversi"
              dari angka ini akan menyesatkan, jadi sengaja tidak ditampilkan. */}
          <Panel
            title="Sebaran deal per tahap"
            wide
            hint="Panjang bar = jumlah deal; angka di kanan = nilai × peluang. Potret posisi saat ini, bukan laju konversi antar tahap."
          >
            <div className="space-y-1.5">
              {ins.funnel.map((r) => {
                const share = r.count / maxFunnel;
                // Label duduk di dalam bar hanya kalau barnya cukup lebar; bar
                // pendek labelnya ditaruh setelah ujung bar dengan tinta normal,
                // supaya tak pernah jadi teks putih di atas track kosong.
                const inside = share >= 0.18;
                return (
                  <div key={r.key} className="flex items-center gap-2">
                    <div className="w-[86px] shrink-0 text-xs">{r.label}</div>
                    <div className="bg-muted/50 relative h-6 flex-1 overflow-hidden rounded">
                      <div className="h-full rounded transition-all"
                        style={{ width: `${Math.max(r.count > 0 ? 2 : 0, share * 100)}%`, background: stageFill(r.key) }} />
                      {r.count > 0 && (
                        <div className="absolute inset-y-0 flex items-center text-[11px] font-medium tabular-nums"
                          style={inside
                            ? { left: 8, color: stageInk(r.key) }
                            : { left: `calc(${share * 100}% + 8px)` }}>
                          {r.count} deal
                        </div>
                      )}
                    </div>
                    <div className="text-muted-foreground w-[76px] shrink-0 text-right text-xs tabular-nums">{rpC(r.weighted)}</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Hasil deal — donut 3 irisan + win rate sebagai angka utama. */}
          <Panel
            title="Hasil deal"
            empty={ins.result.length === 0}
            hint={ins.winRate == null
              ? "Win rate belum bisa dihitung: belum ada deal yang diputus (Won/Lost) pada filter ini."
              : `Win rate = ${ins.won} Won ÷ ${ins.won + ins.lost} deal yang sudah diputus. Deal yang masih jalan tidak ikut menghitung.`}
          >
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={168}>
                <PieChart>
                  <Pie data={ins.result} dataKey="count" nameKey="label" innerRadius={46} outerRadius={72} paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
                    {ins.result.map((r) => <Cell key={r.key} fill={RESULT_FILL[r.key as keyof typeof RESULT_FILL]} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as Row;
                    return (
                      <div className="bg-card border-border rounded-md border px-3 py-2 text-xs shadow-md">
                        <div className="font-semibold">{p.label}</div>
                        <div className="tabular-nums">{p.count} deal</div>
                      </div>
                    );
                  }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                <div>
                  <div className="text-muted-foreground text-xs">Win Rate</div>
                  <div className="text-2xl font-bold tabular-nums">
                    {ins.winRate == null ? "—" : `${Math.round(ins.winRate * 1000) / 10}%`}
                  </div>
                </div>
                {/* Legend + label langsung: identitas irisan tak pernah cuma dari warna. */}
                <ul className="space-y-1 text-xs">
                  {[
                    { k: "won", label: "Won", n: ins.won },
                    { k: "lost", label: "Lost", n: ins.lost },
                    { k: "open", label: "Masih jalan", n: ins.openCount },
                  ].map((r) => (
                    <li key={r.k} className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RESULT_FILL[r.k as keyof typeof RESULT_FILL] }} />
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="font-medium tabular-nums">{r.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          {/* Estimasi closing per bulan (deal yang masih jalan). */}
          <Panel
            title="Estimasi closing per bulan"
            empty={ins.eta.length === 0}
            hint={`Nilai × peluang deal yang masih jalan, menurut estimasi bulan beli.${ins.noEta > 0 ? ` ${ins.noEta} deal belum mengisi bulan/tahun — tidak masuk grafik ini.` : ""}`}
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={ins.eta} margin={{ left: 4, right: 8, top: 4, bottom: 4 }} barCategoryGap={4}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
                <XAxis dataKey="label" fontSize={10} interval={0} angle={-30} textAnchor="end" height={44} />
                {/* width 72: "Rp 220jt" masih pecah dua baris di 64. */}
                <YAxis tickFormatter={(v) => rpTick(Number(v))} fontSize={10} width={72} />
                <Tooltip content={<RowTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Bar dataKey="weighted" fill={BAR_FILL} radius={[4, 4, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel
            title="Brand teratas (deal masih jalan)"
            empty={ins.brands.length === 0}
            hint="Panjang bar = nilai × peluang. Deal Won/Lost tidak dihitung."
          >
            <HBar rows={ins.brands} />
          </Panel>

          <Panel
            title="AM teratas (deal masih jalan)"
            empty={ins.ams.length === 0}
            hint="Panjang bar = nilai × peluang deal yang masih jalan per Account Manager."
          >
            <HBar rows={ins.ams} />
          </Panel>
        </div>
      ))}
    </Card>
  );
}
