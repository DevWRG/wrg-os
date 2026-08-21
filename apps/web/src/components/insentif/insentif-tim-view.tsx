import Link from "next/link";
import { Coins, Users, PiggyBank, Building2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import {
  angka, periodeLabel, rupiah, statusTone, type TimResult,
} from "./insentif-format";

// Menu tim. SATU halaman untuk HoD, Finance, dan Direktur — dibedakan oleh scope yang
// dihitung SERVER, bukan oleh route (§E.3). Respons memuat `scope` supaya UI bisa
// menyembunyikan yang tak relevan; UI TIDAK pernah menyimpulkan izin sendiri.
//
// Total di kartu dijumlah dari baris yang sudah ter-scope (§E.2.6) — untuk HoD itu total
// cabang timnya, bukan total nasional. Kalau suatu saat totalnya diambil dari query
// terpisah, itu jalan pintas yang membocorkan angka perusahaan ke HoD.

export function InsentifTimView({ data }: { data: TimResult }) {
  const { periode, scope, baris, total_am, total_ho } = data;

  const lingkup =
    scope === "all"
      ? { label: "Semua cabang", hint: "Anda melihat seluruh AM." }
      : { label: "Cabang tim Anda", hint: "Dibatasi hod_territory — AM cabang lain tidak muncul." };

  if (baris.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Building2 className="size-3" />
            {lingkup.label}
          </Badge>
        </div>
        <EmptyState
          icon={Coins}
          title={`Belum ada rekap ${periodeLabel(periode)}`}
          description={
            scope === "all"
              ? "Belum ada AM yang punya rekap pada periode ini. Kalau periodenya sudah lewat, jalankan hitung ulang."
              : "Belum ada AM di cabang tim Anda yang punya rekap pada periode ini. Daftar kosong ini bukan penolakan akses."
          }
        />
      </div>
    );
  }

  const denganCap = baris.filter((r) => r.cap_bulanan > 0 && r.total_insentif_am > r.cap_bulanan).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Building2 className="size-3" />
          {lingkup.label}
        </Badge>
        <span className="text-muted-foreground text-xs">{lingkup.hint}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total insentif AM"
          value={rupiah(total_am)}
          delta={`${baris.length} AM · ${periodeLabel(periode)}`}
          icon={Coins}
        />
        <StatCard
          title="HO Pool"
          value={rupiah(total_ho)}
          delta="Porsi yang tidak mengalir ke AM"
          icon={Building2}
        />
        <StatCard
          title="Retention pool"
          value={rupiah(baris.reduce((s, r) => s + r.retention_pool, 0))}
          delta="Ditahan dari kelebihan batas bulanan"
          icon={PiggyBank}
        />
        <StatCard
          title="Kena batas bulanan"
          value={angka(denganCap)}
          delta={denganCap > 0 ? "Selisihnya masuk retention pool" : "Tak ada yang melewati batas"}
          deltaTone={denganCap > 0 ? "negative" : "neutral"}
          icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rekap per AM · {periodeLabel(periode)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AM</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Transaksi</TableHead>
                  <TableHead className="text-right">Insentif AM</TableHead>
                  <TableHead className="text-right">HO Pool</TableHead>
                  <TableHead className="text-right">Dibayar</TableHead>
                  <TableHead className="text-right">Retention</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((r) => {
                  const { label } = statusTone(r.status);
                  return (
                    <TableRow key={r.am_id}>
                      <TableCell className="font-medium">
                        {/* Rincian per AM: server membalas 404 kalau di luar scope (§E.2.5),
                            jadi tautan ini tak bisa dipakai menebak keberadaan orang. */}
                        <Link
                          href={`/insentif/tim/${encodeURIComponent(r.am_id)}?periode=${periode}`}
                          className="hover:underline"
                        >
                          {r.nama}
                        </Link>
                        {r.panggilan ? (
                          <span className="text-muted-foreground"> · {r.panggilan}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{r.tier_ut || "—"}</TableCell>
                      <TableCell className="text-right">{angka(r.transaksi)}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {rupiah(r.total_insentif_am)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(r.total_insentif_ho)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(r.dibayar)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{rupiah(r.retention_pool)}</TableCell>
                      <TableCell>{label}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
