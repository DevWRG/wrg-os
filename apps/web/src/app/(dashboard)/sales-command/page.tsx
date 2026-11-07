import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Banknote, ClipboardCheck, Gauge, GitBranch, TrendingUp } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { salesCommandAccess } from "@/lib/sales-command-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PratinjauRekapKualitas } from "@/components/sales-command/pratinjau-rekap-kualitas";

export const dynamic = "force-dynamic";

// Sales Command Center (#1979) — cockpit HoD per region. Semua angka diambil dari
// modul asalnya (lihat apps/api/src/repo/sales-command.ts); tiap kartu menautkan ke
// menu sumbernya untuk rincian. HoD terkunci ke region timnya, Direktur/admin memilih.

interface BarisAm {
  am_id: string; nama: string; cabang: string | null; lampu: string; capaian_pct: number | null;
  pacing: string; proyeksi_pct: number | null; plan_report_miss: number; plan_report_expected: number;
  deal_dormant: number; deal_macet: number; pipeline_meragukan: number; ar_90: number; skor: number;
}
interface Data {
  region: "East" | "West"; regions: string[]; tanggal: string; minggu_dari: string; cabang: string[];
  so_pacing: { pct_pacing: number | null; pct_bulan: number | null; status: string; faktur: number; so_terbuka: number;
    target_bulan: number; hari_kerja_lewat: number; hari_kerja_bulan: number } | null;
  ytd: { target: number; actual: number; elapsed_pct: number };
  lampu: { green: number; yellow: number; red: number };
  plan_report: { am_miss: number; miss: number; expected: number };
  pipeline: { total_value: number; weighted_value: number; dormant: number; macet: number; meragukan: number; nilai_meragukan: number };
  ar: { outstanding: number; lewat_90: number; kritis: number };
  per_am: BarisAm[];
  kualitas_data: {
    terbuka: number; bulan_lewat: number; tanpa_bulan: number; tanpa_nilai: number;
    per_am: { am_id: string | null; nama: string; terbuka: number; bulan_lewat: number; tanpa_bulan: number; tanpa_nilai: number }[];
    deals: { deal_id: string; am: string | null; faskes: string; stage: string; purchase_month: number | null; purchase_year: number | null; nilai: number | null; masalah: string[] }[];
  };
  dormant_teratas: { deal_id: string; faskes: string; am: string | null; stage: string; nilai: number | null; gugur_at: string | null; days_idle: number | null }[];
  alert_aktif: { id: number; nama: string; metrik: string }[];
}

const jt = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`
    : `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 0 })} jt`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);
const tgl = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "—";

// Chip: bg-<warna>-500/10 — `bg-muted` tak terlihat di mode terang.
const CHIP: Record<string, string> = {
  merah: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  kuning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  hijau: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  netral: "border border-border text-muted-foreground",
};
const LAMPU: Record<string, [string, string]> = {
  red: ["merah", "Merah"], yellow: ["kuning", "Kuning"], green: ["hijau", "Hijau"], na: ["netral", "—"],
};
const PACING: Record<string, [string, string]> = {
  behind: ["merah", "Tertinggal"], "at-risk": ["kuning", "Berisiko"], "on-track": ["hijau", "On track"], "n/a": ["netral", "—"],
};
function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", CHIP[tone] ?? CHIP.netral)}>{children}</span>;
}
function Angka({ n, merah, rp }: { n: number; merah?: boolean; rp?: boolean }) {
  if (!n) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("tabular-nums", merah && "font-medium text-rose-700 dark:text-rose-400")}>{rp ? jt(n) : n}</span>;
}

export default async function SalesCommandPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const access = me ? salesCommandAccess(me) : null;
  if (!me || !access) redirect("/");
  const region = access === "full" && (sp.region === "East" || sp.region === "West") ? `?region=${sp.region}` : "";

  let data: Data | null = null;
  let galat: string | null = null;
  try {
    const res = await gatewayFetch(`/sales-command${region}`, { headers: { "x-user-id": me.id } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) data = body as Data;
    else galat = typeof body?.error === "string" ? body.error : `gagal memuat (${res.status})`;
  } catch {
    galat = "backend tidak terjangkau";
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Sales Command Center" description="Cockpit HoD per region." />
        <Card><CardContent className="py-8 text-sm text-muted-foreground">{galat}</CardContent></Card>
      </>
    );
  }

  const d = data;
  const sp21 = d.so_pacing;
  const ytdPct = d.ytd.target > 0 ? (d.ytd.actual / d.ytd.target) * 100 : null;
  const perhatian = d.per_am.filter((b) => b.skor > 0);
  const aman = d.per_am.length - perhatian.length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sales Command Center"
        description={`Region ${d.region} · ${d.cabang.length} cabang · per ${tgl(d.tanggal)}. Ringkasan dari Sales Analytics, Pipeline, PLAN/REPORT, dan AR — klik judul kartu untuk rinciannya.`}
        action={d.regions.length > 1 ? (
          <div className="flex gap-1 rounded-md border border-border p-1">
            {d.regions.map((r) => (
              <Link key={r} href={`/sales-command?region=${r}`}
                className={cn("rounded px-3 py-1 text-sm", r === d.region ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
                {r}
              </Link>
            ))}
          </div>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Link href="/sales-analytics"><StatCard title="Pacing bulan ini" icon={Gauge}
          value={sp21 ? pct(sp21.pct_pacing) : "—"}
          delta={sp21 ? `${jt(sp21.faktur + sp21.so_terbuka)} dari target ${jt(sp21.target_bulan)} · hari kerja ${sp21.hari_kerja_lewat}/${sp21.hari_kerja_bulan}` : "target region belum diisi"}
          deltaTone={sp21?.status === "HIJAU" ? "positive" : sp21?.status === "MERAH" ? "negative" : "neutral"} /></Link>
        <Link href="/sales-analytics"><StatCard title="Capaian YTD" icon={TrendingUp}
          value={pct(ytdPct)} delta={`${jt(d.ytd.actual)} / ${jt(d.ytd.target)} · tahun berjalan ${pct(d.ytd.elapsed_pct)}`}
          deltaTone={ytdPct != null && ytdPct >= d.ytd.elapsed_pct ? "positive" : "negative"} /></Link>
        <Link href="/plan-report"><StatCard title="PLAN/REPORT minggu ini" icon={ClipboardCheck}
          value={`${d.plan_report.miss} bolong`} delta={`${d.plan_report.am_miss} AM · dari ${d.plan_report.expected} wajib sejak ${tgl(d.minggu_dari)}`}
          deltaTone={d.plan_report.miss > 0 ? "negative" : "positive"} /></Link>
        <Link href="/pipeline"><StatCard title="Pipeline" icon={GitBranch}
          value={jt(d.pipeline.weighted_value)} delta={`tertimbang · ${d.pipeline.dormant} Dormant · ${d.pipeline.macet} macet · ${d.pipeline.meragukan} meragukan`}
          deltaTone={d.pipeline.dormant + d.pipeline.meragukan > 0 ? "negative" : "neutral"} /></Link>
        <Link href="/ar"><StatCard title="AR > 90 hari" icon={Banknote}
          value={jt(d.ar.lewat_90)} delta={`dari outstanding ${jt(d.ar.outstanding)} · ${d.ar.kritis} customer kritis`}
          deltaTone={d.ar.lewat_90 > 0 ? "negative" : "positive"} /></Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">AM perlu perhatian</CardTitle>
          <span className="text-xs text-muted-foreground">
            {perhatian.length} AM bersinyal · {aman} aman · lampu: {d.lampu.red} merah, {d.lampu.yellow} kuning, {d.lampu.green} hijau
          </span>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {d.per_am.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada AM di region ini.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AM</TableHead>
                  <TableHead>Lampu YTD</TableHead>
                  <TableHead>Pacing tahun</TableHead>
                  <TableHead className="text-right">PLAN/REPORT bolong</TableHead>
                  <TableHead className="text-right">Dormant</TableHead>
                  <TableHead className="text-right">Macet</TableHead>
                  <TableHead className="text-right">Pipeline meragukan</TableHead>
                  <TableHead className="text-right">AR &gt; 90</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.per_am.map((b) => {
                  const [lt, ll] = LAMPU[b.lampu] ?? LAMPU.na;
                  const [pt, pl] = PACING[b.pacing] ?? PACING["n/a"];
                  return (
                    <TableRow key={b.am_id}>
                      <TableCell>
                        <Link href={`/sales-analytics/am/${encodeURIComponent(b.am_id)}`} className="font-medium hover:underline">{b.nama}</Link>
                        <div className="text-xs text-muted-foreground">{b.cabang ?? "—"}</div>
                      </TableCell>
                      <TableCell><Chip tone={lt}>{ll}{b.capaian_pct != null ? ` · ${pct(b.capaian_pct)}` : ""}</Chip></TableCell>
                      <TableCell><Chip tone={pt}>{pl}{b.proyeksi_pct != null ? ` · proyeksi ${pct(b.proyeksi_pct)}` : ""}</Chip></TableCell>
                      <TableCell className="text-right">
                        {b.plan_report_expected ? <><Angka n={b.plan_report_miss} merah /><span className="text-xs text-muted-foreground"> / {b.plan_report_expected}</span></> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right"><Angka n={b.deal_dormant} merah /></TableCell>
                      <TableCell className="text-right"><Angka n={b.deal_macet} /></TableCell>
                      <TableCell className="text-right"><Angka n={b.pipeline_meragukan} merah /></TableCell>
                      <TableCell className="text-right"><Angka n={b.ar_90} merah rp /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Urut dari sinyal terbanyak (pacing Tertinggal, PLAN/REPORT bolong, Dormant, meragukan, AR &gt; 90). Lampu YTD = capaian vs
            target SETAHUN penuh (AM Radar) — hanya informasi, tak dihitung sebagai sinyal; pacing tahun = proyeksi akhir tahun
            (Sales Analytics → Pacing); PLAN/REPORT sejak Senin; Dormant/macet = deal opsi utama; meragukan = Keaslian Pipeline.
          </p>
        </CardContent>
      </Card>

      <KartuKualitasData k={d.kualitas_data} region={d.region} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base"><Link href="/pipeline" className="hover:underline">Deal Dormant — segera gugur</Link></CardTitle></CardHeader>
          <CardContent>
            {d.dormant_teratas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tak ada deal Dormant di region ini.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.dormant_teratas.map((x) => (
                  <li key={x.deal_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{x.faskes}</span>
                      <span className="text-xs text-muted-foreground">{x.am ?? "tanpa AM"} · {x.stage} · {x.days_idle ?? "?"} hari diam</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Chip tone="merah">gugur {tgl(x.gugur_at)}</Chip>
                      <span className="block text-xs tabular-nums text-muted-foreground">{jt(x.nilai)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base"><Link href="/sales-alerts" className="hover:underline">Alert aktif Anda</Link></CardTitle></CardHeader>
          <CardContent>
            {d.alert_aktif.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tak ada alert Anda yang sedang melewati ambang.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.alert_aktif.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="font-medium">{a.nama}</span>
                    <span className="text-xs text-muted-foreground">{a.metrik}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const MASALAH: Record<string, string> = { bulan_lewat: "bulan beli lewat", tanpa_bulan: "bulan beli kosong", tanpa_nilai: "tanpa nilai" };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Kualitas data pipeline — prasyarat forecast per region (Fase B ditunda sampai data
// layak: cek prod 4 Nov 2026, 75% estimasi bulan beli sudah lewat). Tiap deal menaut ke
// board Pipeline (?deal=) supaya AM/HoD langsung memperbarui bulan beli & nilainya.
function KartuKualitasData({ k, region }: { k: Data["kualitas_data"]; region: "East" | "West" }) {
  const pct = (n: number) => (k.terbuka ? Math.round((n / k.terbuka) * 100) : 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Kualitas data pipeline</CardTitle>
        <span className="text-xs text-muted-foreground">{k.terbuka} deal terbuka (opsi utama)</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Chip tone={k.bulan_lewat ? "merah" : "hijau"}>{k.bulan_lewat} bulan beli lewat · {pct(k.bulan_lewat)}%</Chip>
          <Chip tone={k.tanpa_bulan ? "kuning" : "hijau"}>{k.tanpa_bulan} bulan beli kosong · {pct(k.tanpa_bulan)}%</Chip>
          <Chip tone={k.tanpa_nilai ? "kuning" : "hijau"}>{k.tanpa_nilai} tanpa nilai · {pct(k.tanpa_nilai)}%</Chip>
        </div>
        <p className="text-xs text-muted-foreground">
          Forecast per region menunggu data ini layak: deal yang masih jalan tapi estimasi bulan belinya sudah lewat, kosong,
          atau tanpa nilai tak bisa dipakai memperkirakan penjualan. Perbarui lewat tombol Edit di detail deal.
        </p>
        <PratinjauRekapKualitas region={region} />
        {k.per_am.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AM</TableHead>
                  <TableHead className="text-right">Deal terbuka</TableHead>
                  <TableHead className="text-right">Bulan beli lewat</TableHead>
                  <TableHead className="text-right">Bulan beli kosong</TableHead>
                  <TableHead className="text-right">Tanpa nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {k.per_am.map((a) => (
                  <TableRow key={a.am_id ?? a.nama}>
                    <TableCell className="font-medium">{a.nama}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.terbuka}</TableCell>
                    <TableCell className="text-right"><Angka n={a.bulan_lewat} merah /></TableCell>
                    <TableCell className="text-right"><Angka n={a.tanpa_bulan} /></TableCell>
                    <TableCell className="text-right"><Angka n={a.tanpa_nilai} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {k.deals.length > 0 && (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Daftar deal yang perlu diperbarui ({k.deals.length}{k.deals.length >= 150 ? "+" : ""})
            </summary>
            <ul className="flex flex-col divide-y divide-border">
              {k.deals.map((x) => (
                <li key={x.deal_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <Link href={`/pipeline?deal=${encodeURIComponent(x.deal_id)}`} className="block truncate font-medium hover:underline">{x.faskes}</Link>
                    <span className="text-xs text-muted-foreground">
                      {x.am ?? "tanpa AM"} · {x.stage} · beli {x.purchase_month && x.purchase_year ? `${BULAN[x.purchase_month - 1]} ${x.purchase_year}` : "—"} · {jt(x.nilai)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    {x.masalah.map((m) => <Chip key={m} tone={m === "bulan_lewat" ? "merah" : "kuning"}>{MASALAH[m] ?? m}</Chip>)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
