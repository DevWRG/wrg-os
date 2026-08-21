import { Coins, Receipt, PiggyBank, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import {
  agingHint, agingLabel, gpHint, gpLabel, periodeLabel, persen, rupiah,
  statusTone, tanggalSingkat,
  type BarisBulanan, type BarisTransaksi,
} from "./insentif-format";

// Rincian insentif satu orang — kartu ringkas + tabel per transaksi. Dipakai halaman
// rincian AM di menu tim (/insentif/tim/[amId]). Tidak ada total perusahaan
// sebagai pembanding di halaman ini (§E.2.6), dan tidak ada peringkat antar-AM (§E.2.8):
// yang dibandingkan di sini angka penghasilan orang, bukan skor kinerja.

function StatusBadge({ status }: { status: string }) {
  const { label, tone } = statusTone(status);
  const kelas =
    tone === "selesai"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : tone === "tahan"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500"
        : tone === "jalan"
          ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400"
          : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={kelas}>{label}</Badge>;
}

export function InsentifRincian({
  periode,
  ringkas,
  transaksi,
}: {
  periode: string;
  ringkas: BarisBulanan | null;
  transaksi: BarisTransaksi[];
}) {
  if (!ringkas) {
    return (
      <EmptyState
        icon={Coins}
        title={`Belum ada rekap ${periodeLabel(periode)}`}
        description="Insentif dihitung dari invoice yang sudah LUNAS pada periode ini. Kalau periodenya baru berjalan atau belum dihitung ulang, rekapnya memang belum ada."
      />
    );
  }

  const sisaCap = ringkas.cap_bulanan > 0 ? ringkas.cap_bulanan - ringkas.dibayar : null;
  const kenaCap = ringkas.cap_bulanan > 0 && ringkas.total_insentif_am > ringkas.cap_bulanan;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Insentif periode ini"
          value={rupiah(ringkas.total_insentif_am)}
          delta={`${ringkas.transaksi} transaksi lunas`}
          icon={Coins}
        />
        <StatCard
          title="Dibayar"
          value={rupiah(ringkas.dibayar)}
          delta={
            kenaCap
              ? `Kena batas bulanan ${rupiah(ringkas.cap_bulanan)}`
              : sisaCap != null
                ? `Sisa ruang batas ${rupiah(sisaCap)}`
                : undefined
          }
          deltaTone={kenaCap ? "negative" : "neutral"}
          icon={Receipt}
        />
        <StatCard
          title="Retention pool"
          value={rupiah(ringkas.retention_pool)}
          delta="Ditahan, cair menyusul aturan retensi"
          icon={PiggyBank}
        />
        <StatCard
          title="Tier / status"
          value={ringkas.tier_ut || "—"}
          delta={statusTone(ringkas.status).label}
          icon={Gauge}
        />
      </div>

      {kenaCap && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 text-sm">
            <span className="font-medium">Insentif melebihi batas bulanan.</span>{" "}
            Hitungan mentah {rupiah(ringkas.total_insentif_am)} di atas batas{" "}
            {rupiah(ringkas.cap_bulanan)}, jadi selisihnya masuk retention pool — bukan hilang.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Rincian per transaksi · {periodeLabel(periode)}
          </CardTitle>
          <StatusBadge status={ringkas.status} />
        </CardHeader>
        <CardContent>
          {transaksi.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Rekap ada, tapi rinciannya kosong. Jalankan hitung ulang periode ini.
            </p>
          ) : (
            // Tabel lebar → scroll di dalam containernya sendiri, bukan mendorong halaman.
            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                    <TableHead className="text-right">MR</TableHead>
                    <TableHead className="text-right">NCR</TableHead>
                    <TableHead className="text-right">Umur lunas</TableHead>
                    <TableHead className="text-right">CF</TableHead>
                    <TableHead className="text-right">Pengali</TableHead>
                    <TableHead className="text-right">Insentif</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transaksi.map((t) => (
                    <TableRow key={t.invoice_no}>
                      <TableCell className="font-medium whitespace-nowrap">{t.invoice_no}</TableCell>
                      <TableCell className="whitespace-nowrap">{tanggalSingkat(t.tanggal)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(t.revenue)}</TableCell>
                      <TableCell
                        className="text-right whitespace-nowrap"
                        title={gpHint(t.gp_actual_pct) ?? undefined}
                      >
                        {t.gp_actual_pct == null ? (
                          <span className="text-muted-foreground italic">{gpLabel(null)}</span>
                        ) : (
                          gpLabel(t.gp_actual_pct)
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{persen(t.mr_pct, 0)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{persen(t.ncr_pct, 0)}</TableCell>
                      <TableCell
                        className="text-right whitespace-nowrap"
                        title={agingHint(t.aging_days) ?? undefined}
                      >
                        {t.aging_days == null ? (
                          <span className="text-muted-foreground italic">{agingLabel(null)}</span>
                        ) : (
                          agingLabel(t.aging_days)
                        )}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{t.cf.toFixed(2)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{t.pengali.toFixed(3)}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {rupiah(t.insentif_am)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
            <span className="font-medium">Cara baca dua kolom yang bisa berbunyi &ldquo;tak diketahui&rdquo;.</span>{" "}
            <span className="italic">GP</span> kosong berarti HPP tak ketemu untuk semua baris invoice
            (atau kodenya ber-HPP ganda) — Margin Reward jadi 0 karena <em>tak diketahui</em>, bukan
            karena marginnya nol; yang perlu dibenahi Price Book.{" "}
            <span className="italic">Umur lunas</span> kosong berarti tanggal pelunasan belum tercatat,
            dan Collection Factor diperlakukan <strong>netral 1,00</strong> — tidak dihukum, tidak dihadiahi.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
