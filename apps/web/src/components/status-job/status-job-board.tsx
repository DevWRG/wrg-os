"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type StatusJob = "OK" | "GAGAL" | "TERLEWAT" | "BELUM_JALAN" | "NONAKTIF";

interface BarisJob {
  job: string;
  expr: string | null;
  aktif: boolean;
  status: StatusJob;
  berikut: string | null;
  terakhir: { mulai: string; selesai: string; durasi_detik: number; ok: boolean; galat: string | null; ringkasan: string | null } | null;
  terakhir_ok: string | null;
  gagal_7_hari: number;
  jalan_7_hari: number;
}

const LABEL: Record<StatusJob, string> = {
  OK: "OK",
  GAGAL: "Gagal",
  TERLEWAT: "Terlewat",
  BELUM_JALAN: "Belum jalan",
  NONAKTIF: "Nonaktif",
};

const WARNA: Record<StatusJob, string> = {
  OK: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  GAGAL: "border-destructive/30 bg-destructive/10 text-destructive",
  TERLEWAT: "border-amber-600/30 bg-amber-500/15 text-amber-800 dark:text-amber-300",
  BELUM_JALAN: "border-sky-600/30 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  NONAKTIF: "border-border text-muted-foreground",
};

const waktu = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const durasi = (d: number): string => (d < 60 ? `${d} dtk` : d < 3600 ? `${Math.round(d / 60)} mnt` : `${(d / 3600).toFixed(1)} jam`);

export function StatusJobBoard() {
  const [jobs, setJobs] = useState<BarisJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    setSibuk(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/jobs/status", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(d.error ?? `HTTP ${res.status}`));
      setJobs(d.jobs as BarisJob[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "gagal memuat");
    } finally {
      setSibuk(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- muat() men-setState saat fetch; disengaja.
    void muat();
  }, [muat]);

  const hitung = (s: StatusJob) => jobs?.filter((j) => j.status === s).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["GAGAL", "TERLEWAT", "BELUM_JALAN", "OK", "NONAKTIF"] as StatusJob[]).map((s) => (
          <Badge key={s} variant="outline" className={WARNA[s]}>
            {LABEL[s]} · {hitung(s)}
          </Badge>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => void muat()} disabled={sibuk}>
          <RefreshCw className={`size-4 ${sibuk ? "animate-spin" : ""}`} /> Muat ulang
        </Button>
      </div>

      {err ? <p className="text-destructive text-sm">{err}</p> : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Terakhir jalan</TableHead>
                <TableHead>Terakhir berhasil</TableHead>
                <TableHead>Berikutnya</TableHead>
                <TableHead className="text-right">7 hari</TableHead>
                <TableHead>Catatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs === null ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    {sibuk ? "Memuat…" : "—"}
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((j) => (
                  <TableRow key={j.job}>
                    <TableCell>
                      <div className="font-medium">{j.job}</div>
                      <div className="text-muted-foreground font-mono text-xs">{j.expr ?? "—"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={WARNA[j.status]}>
                        {LABEL[j.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {waktu(j.terakhir?.mulai ?? null)}
                      {j.terakhir ? <div className="text-muted-foreground text-xs">{durasi(j.terakhir.durasi_detik)}</div> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{waktu(j.terakhir_ok)}</TableCell>
                    <TableCell className="whitespace-nowrap">{waktu(j.berikut)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {j.jalan_7_hari}×{j.gagal_7_hari ? <span className="text-destructive"> · {j.gagal_7_hari} gagal</span> : null}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <p className={`line-clamp-2 text-xs ${j.terakhir?.galat ? "text-destructive" : "text-muted-foreground"}`} title={j.terakhir?.galat ?? j.terakhir?.ringkasan ?? ""}>
                        {j.terakhir?.galat ?? j.terakhir?.ringkasan ?? ""}
                      </p>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">
        Terlewat = jadwal berikutnya sudah lewat lebih dari 15 menit tanpa eksekusi baru. Gagal = job melempar galat atau menulis galat ke log.
        Nonaktif = pernah jalan tapi saklarnya kini mati. Riwayat disimpan 30 hari.
      </p>
    </div>
  );
}
