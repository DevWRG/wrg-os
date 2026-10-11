import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// F21 — Pacing bulan berjalan per region: faktur netto + SO terbuka sejak tgl 1
// vs target bulan (menu Sales Targets) diprorata HARI KERJA. Dihitung di
// apps/api/src/repo/so-pacing.ts; faktur memakai fungsi yang sama dengan kartu
// Sales Performance di atasnya, jadi angkanya identik.

type StatusPacing = "MERAH" | "KUNING" | "HIJAU" | "TANPA_TARGET";
export interface SoPacingRegion {
  region: "East" | "West";
  target_bulan: number | null; target_prorata: number | null;
  faktur: number; so_terbuka: number; capaian: number;
  pct_pacing: number | null; pct_bulan: number | null; status: StatusPacing;
  so_hari_ini: number; so_hari_ini_jumlah: number;
}
export interface SoPacing {
  tanggal: string; bulan: string; hari_kerja_bulan: number; hari_kerja_lewat: number;
  regions: SoPacingRegion[]; office: { faktur: number; so_terbuka: number };
  ambang: { merah: number; kuning: number };
}

const rpC = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const rpFull = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// Token warna sama dengan kartu Sales Performance (bg-success/warning/danger).
const TONE: Record<StatusPacing, { bar: string; text: string; label: string }> = {
  HIJAU: { bar: "bg-success", text: "text-success", label: "Sesuai jalur" },
  KUNING: { bar: "bg-warning", text: "text-warning", label: "Perlu dikejar" },
  MERAH: { bar: "bg-danger", text: "text-danger", label: "Tertinggal" },
  TANPA_TARGET: { bar: "bg-muted-foreground/30", text: "text-muted-foreground", label: "Target belum diisi" },
};

function RegionPacing({ r }: { r: SoPacingRegion }) {
  const t = TONE[r.status];
  // Bar = capaian terhadap target SEBULAN; garis tegak = posisi target prorata hari ini.
  const isi = r.target_bulan ? Math.min(100, (r.capaian / r.target_bulan) * 100) : 0;
  const garis = r.target_bulan && r.target_prorata ? Math.min(100, (r.target_prorata / r.target_bulan) * 100) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{r.region}</span>
        <span className={cn("text-xs font-semibold", t.text)}>{t.label}</span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", t.text)}>
        {r.pct_pacing != null ? `${r.pct_pacing}%` : "—"}
        <span className="text-muted-foreground ml-1 text-xs font-normal">dari target s/d hari ini</span>
      </div>
      <div className="bg-muted-foreground/15 relative h-2 overflow-hidden rounded-full" title={r.target_bulan ? `Capaian ${rpFull(r.capaian)} dari target sebulan ${rpFull(r.target_bulan)}` : undefined}>
        <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${isi}%` }} />
        {garis != null && <div className="bg-foreground/70 absolute top-0 h-full w-0.5" style={{ left: `${garis}%` }} />}
      </div>
      <div className="text-muted-foreground space-y-0.5 text-xs tabular-nums">
        <div>Capaian {rpC(r.capaian)} = faktur {rpC(r.faktur)} + SO terbuka {rpC(r.so_terbuka)}</div>
        {r.target_bulan != null && (
          <div>Target s/d hari ini {rpC(r.target_prorata ?? 0)} · sebulan {rpC(r.target_bulan)} ({r.pct_bulan}% tercapai)</div>
        )}
        <div>SO masuk hari ini: {r.so_hari_ini_jumlah} ({rpC(r.so_hari_ini)})</div>
      </div>
    </div>
  );
}

export function SoPacingCard({ data }: { data: SoPacing }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pacing Bulan Ini per Region</CardTitle>
        <p className="text-muted-foreground text-xs">
          {data.bulan} · s/d {data.tanggal} · hari kerja {data.hari_kerja_lewat}/{data.hari_kerja_bulan}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-6 sm:grid-cols-2">
          {data.regions.map((r) => <RegionPacing key={r.region} r={r} />)}
        </div>
        <p className="text-muted-foreground text-xs">
          Target bulan dari menu Sales Targets, diprorata hari kerja (garis tegak = posisi target hari ini).
          Merah di bawah {data.ambang.merah}%, kuning di bawah {data.ambang.kuning}%. SO terbuka = SO berstatus
          “Menunggu diproses” (belum jadi faktur). OFFICE/VACANT tanpa target: faktur {rpC(data.office.faktur)}.
        </p>
      </CardContent>
    </Card>
  );
}
