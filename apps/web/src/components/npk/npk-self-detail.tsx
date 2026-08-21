"use client";

import { Info } from "lucide-react";
import {
  PolarAngleAxis, PolarGrid, Radar, RadarChart, RadialBar, RadialBarChart,
  ResponsiveContainer,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PredikatBadge } from "./predikat-badge";
import { fmt1, periodLabel, scoreBand, type NpkDetailResult } from "./npk-format";
import { TOTAL_ASPEK, zoneOf } from "./npk-status";

// Badge status: saat coverage < 7/7 predikat SK DITAHAN (plafon skor < 100 → predikat
// selalu jatuh ke "Buruk" walau kinerja normal). Lihat catatan di npk-status.ts.
function StatusBadge({ data, className }: { data: NpkDetailResult; className?: string }) {
  if (data.available_count >= TOTAL_ASPEK) return <PredikatBadge predikat={data.predikat} className={className} />;
  const z = zoneOf({ predikat: data.predikat, available_count: data.available_count });
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", z.cls, className)}>{z.label}</span>;
}

export function NpkSelfDetail({ data }: { data: NpkDetailResult | null }) {
  if (!data) return <Card><CardContent className="py-10 text-center text-muted-foreground">Gagal memuat NPK.</CardContent></Card>;

  const provisional = data.available_count < TOTAL_ASPEK;
  // Plafon = Σ bobot aspek yang ada datanya (bukan 100) → gauge & label jujur.
  const ceiling = provisional
    ? data.aspects.filter((a) => a.available).reduce((a, x) => a + x.weight, 0)
    : 100;
  const band = scoreBand(data.npk);
  const radar = data.aspects.map((a) => ({
    aspect: a.label.split(" ")[0],
    full: a.label,
    value: a.available && a.capped != null ? a.capped : 0,
    available: a.available,
  }));

  return (
    <div className="flex flex-col gap-4">
      {!data.computed && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-700 dark:text-amber-400">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>NPK {periodLabel(data.period)} {data.year} belum di-compute. Hubungi admin untuk menjalankan compute.</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Gauge NPK */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle>{data.subject_name}</CardTitle>
            <p className="text-xs text-muted-foreground">{data.role} · {periodLabel(data.period)} {data.year}</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2 pt-4">
            <div className="relative h-44 w-44">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ value: Math.min(ceiling, data.npk), fill: band.hex }]} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, ceiling]} angleAxisId={0} tick={false} />
                  <RadialBar background dataKey="value" cornerRadius={12} angleAxisId={0} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn("text-4xl font-bold tabular-nums", band.text)}>{fmt1(data.npk)}</span>
                <span className="text-xs text-muted-foreground">NPK / {ceiling}{provisional && " (sementara)"}</span>
              </div>
            </div>
            <StatusBadge data={data} className="h-6 px-3 text-sm" />
            <p className="text-xs text-muted-foreground">Coverage data: <span className="font-medium text-foreground">{data.available_count}/7 aspek</span></p>
          </CardContent>
        </Card>

        {/* Radar 7 aspek */}
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle>Profil 7 Aspek</CardTitle>
            <p className="text-xs text-muted-foreground">Skor ter-cap 0–120 per aspek (SK Pasal 3.1)</p>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid />
                <PolarAngleAxis dataKey="aspect" tick={{ fontSize: 11 }} />
                <Radar dataKey="value" stroke={band.hex} fill={band.hex} fillOpacity={0.35} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown table */}
      <Card>
        <CardHeader className="border-b pb-3"><CardTitle>Rincian Perhitungan</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Aspek</th>
                  <th className="px-3 py-2 text-center">Bobot</th>
                  <th className="px-3 py-2 text-right">Skor Mentah</th>
                  <th className="px-3 py-2 text-right">Ter-cap</th>
                  <th className="px-3 py-2 text-right">Kontribusi</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.aspects.map((a) => {
                  const b = a.available && a.capped != null ? scoreBand(a.capped) : null;
                  return (
                    <tr key={a.key} className={cn("border-b last:border-0", !a.available && "opacity-55")}>
                      <td className="px-4 py-2.5 font-medium">{a.label}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{a.weight}%</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{a.available ? fmt1(a.raw) : "–"}</td>
                      <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums", b?.text)}>{a.available ? fmt1(a.capped) : "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{a.available ? fmt1(a.contribution) : "–"}</td>
                      <td className="px-3 py-2.5 text-center">
                        {a.available
                          ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Terukur</span>
                          : <span className="text-xs text-muted-foreground">Belum ada data</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-4 py-2.5" colSpan={4}>NPK Total</td>
                  <td className={cn("px-3 py-2.5 text-right text-base tabular-nums", band.text)}>{fmt1(data.npk)}</td>
                  <td className="px-3 py-2.5 text-center"><StatusBadge data={data} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Aspek berstatus <span className="font-medium">Belum ada data</span> tidak menaikkan/menurunkan NPK (kontribusi 0) — skor rendah berarti data belum lengkap, bukan kinerja buruk. Karena itu selama coverage &lt; 7/7 skor dibandingkan ke plafon <span className="font-medium">{ceiling}</span> (Σ bobot aspek yang terukur) dan predikat SK ditahan. Sumber KSO/GP/Coaching &amp; target customer menyusul.
      </p>
    </div>
  );
}
