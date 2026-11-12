import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodCard, type SalesPerformance } from "@/components/sales/sales-performance-cards";
import { cn } from "@/lib/utils";

// Infografis "Sales Area Performance" — kartu YTD / bulan / minggu / hari per
// region + tabel per sales (KSO / REGULAR hari ini, YTD vs target tahunan).
// Dibuka dari link WA ringkasan Koord HoD; data dari GET /sales-analytics/area.

export interface BarisSales {
  nama: string;
  region: "East" | "West" | "OFFICE";
  cabang: string | null;
  hari: { kso: number; regular: number; lain: number; total: number };
  ytd: number;
  target: number | null;
  pct_ytd: number | null;
}
export interface BarisCabang {
  cabang: string;
  region: "East" | "West" | "OFFICE";
  hari: { kso: number; regular: number; lain: number; total: number };
  ytd: number;
  target: number | null;
  pct_ytd: number | null;
}
export interface InfografisData {
  performance: SalesPerformance;
  per_sales: BarisSales[];
  per_cabang?: BarisCabang[];
  generated_at: string;
}

const rp = (n: number) => (n === 0 ? "-" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(n));
const URUT_KARTU = ["year", "month", "week", "day"] as const;

// Satu bentuk tabel untuk per sales & per cabang: label, area/region, KSO/REGULAR
// hari ini, total hari ini, Revenue YTD, target tahunan, % YTD.
interface BarisTabel {
  label: string;
  region: string;
  hari: { kso: number; regular: number; lain: number; total: number };
  ytd: number;
  target: number | null;
  pct_ytd: number | null;
}

function TabelPencapaian({ rows, kolomLabel, kolomRegion, kolomTarget }: { rows: BarisTabel[]; kolomLabel: string; kolomRegion: string; kolomTarget: string }) {
  const adaLain = rows.some((r) => r.hari.lain !== 0);
  const total = rows.reduce(
    (a, r) => ({ kso: a.kso + r.hari.kso, regular: a.regular + r.hari.regular, lain: a.lain + r.hari.lain, hari: a.hari + r.hari.total, ytd: a.ytd + r.ytd }),
    { kso: 0, regular: 0, lain: 0, hari: 0, ytd: 0 },
  );
  const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{kolomLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{kolomRegion}</th>
            <th className={th}>KSO</th>
            <th className={th}>REGULAR</th>
            {adaLain && <th className={th}>Lainnya</th>}
            <th className={th}>Total hari ini</th>
            <th className={th}>Revenue YTD</th>
            <th className={th}>{kolomTarget}</th>
            <th className={th}>% YTD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.label}-${r.region}`} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{r.label}</td>
              <td className="text-muted-foreground px-3 py-2">{r.region}</td>
              <td className={td}>{rp(r.hari.kso)}</td>
              <td className={td}>{rp(r.hari.regular)}</td>
              {adaLain && <td className={td}>{rp(r.hari.lain)}</td>}
              <td className={cn(td, "font-semibold")}>{rp(r.hari.total)}</td>
              <td className={td}>{rp(r.ytd)}</td>
              <td className={td}>{r.target == null ? "-" : rp(r.target)}</td>
              <td className={td}>
                {r.pct_ytd == null ? "-" : (
                  <span className="inline-flex items-center gap-2">
                    <span className="bg-muted hidden h-1.5 w-16 overflow-hidden rounded-full sm:inline-block">
                      <span className="bg-primary block h-full" style={{ width: `${Math.min(100, r.pct_ytd)}%` }} />
                    </span>
                    {`${r.pct_ytd.toLocaleString("id-ID")}%`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t font-semibold">
          <tr>
            <td className="px-3 py-2" colSpan={2}>Total keseluruhan</td>
            <td className={td}>{rp(total.kso)}</td>
            <td className={td}>{rp(total.regular)}</td>
            {adaLain && <td className={td}>{rp(total.lain)}</td>}
            <td className={td}>{rp(total.hari)}</td>
            <td className={td}>{rp(total.ytd)}</td>
            <td className={td} colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function AreaInfografis({ data }: { data: InfografisData }) {
  const kartu = URUT_KARTU.map((k) => data.performance.periods.find((p) => p.key === k)).filter((p) => p != null);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kartu.map((p) => <PeriodCard key={p.key} p={p} />)}
      </div>
      {data.per_cabang && data.per_cabang.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-primary text-base font-semibold">Pencapaian per Cabang</CardTitle>
            <p className="text-muted-foreground text-xs">
              Area = cabang AM pada tanggal faktur; faktur tanpa AM ikut lokasi customer. Revenue YTD dibandingkan target tahunan cabang
              (menu Sales Targets → per cabang).
            </p>
          </CardHeader>
          <CardContent>
            <TabelPencapaian
              rows={data.per_cabang.map((r) => ({ ...r, label: r.cabang }))}
              kolomLabel="Cabang" kolomRegion="Region" kolomTarget="Target cabang"
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-primary text-base font-semibold">Pencapaian per Sales</CardTitle>
          <p className="text-muted-foreground text-xs">
            KSO / REGULAR = penjualan hari {data.performance.as_of} menurut kategori pengadaan baris faktur. YTD dibandingkan target tahunan per AM
            (menu Sales Targets). Revenue YTD = omzet netto 1 Jan s/d tanggal ini. VACANT · area = faktur di area yang tak punya AM aktif (termasuk faktur AM yang sudah resign),
            dibandingkan target cabang; VACANT · lainnya = faktur tanpa AM di area yang ada AM-nya / tanpa area, tanpa target. OFFICE tanpa target.
          </p>
        </CardHeader>
        <CardContent>
          <TabelPencapaian
            rows={data.per_sales.map((r) => ({ ...r, label: r.nama }))}
            kolomLabel="Nama Sales" kolomRegion="Area" kolomTarget="Target tahunan"
          />
        </CardContent>
      </Card>
    </div>
  );
}
