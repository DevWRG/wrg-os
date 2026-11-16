"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type StatusLayanan = "OK" | "PERINGATAN" | "MATI";

interface Anggota {
  nama: string;
  label: string;
  sumber: "pm2" | "launchd";
  status: StatusLayanan;
  keadaan: string;
  pid: number | null;
  mulai: string | null;
  restart: number | null;
  mem_mb: number | null;
  cpu: number | null;
  exit: number | null;
}

interface KelompokLayanan {
  kunci: string;
  judul: string;
  status: StatusLayanan;
  anggota: Anggota[];
}

interface KelompokJob {
  kunci: string;
  judul: string;
  status: StatusLayanan;
  total: number;
  ok: number;
  gagal: number;
  terlewat: number;
  belum_jalan: number;
  nonaktif: number;
  bermasalah: string[];
}

interface Peta {
  sekarang: string;
  sumber: { pm2: boolean; launchd: boolean };
  layanan: KelompokLayanan[];
  job: KelompokJob[];
}

const TITIK: Record<StatusLayanan, string> = {
  OK: "bg-emerald-500",
  PERINGATAN: "bg-amber-500",
  MATI: "bg-destructive",
};

const BINGKAI: Record<StatusLayanan, string> = {
  OK: "border-border",
  PERINGATAN: "border-amber-500/50",
  MATI: "border-destructive/50",
};

const LABEL: Record<StatusLayanan, string> = { OK: "Normal", PERINGATAN: "Perlu dicek", MATI: "Bermasalah" };

const MUAT_ULANG_MS = 60_000;

const jam = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function Titik({ status }: { status: StatusLayanan }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${TITIK[status]}`} aria-label={LABEL[status]} />;
}

function detailAnggota(a: Anggota): string {
  const bagian = [a.keadaan === "berkala" ? "berkala, exit 0" : a.keadaan];
  if (a.mulai) bagian.push(`naik sejak ${jam(a.mulai)}`);
  if (a.restart !== null) bagian.push(`restart ${a.restart}×`);
  if (a.mem_mb !== null) bagian.push(`${a.mem_mb} MB`);
  if (a.cpu !== null) bagian.push(`cpu ${a.cpu}%`);
  return bagian.join(" · ");
}

function Ubin({ judul, status, terbuka, onKlik, ringkas, children }: {
  judul: string;
  status: StatusLayanan;
  terbuka: boolean;
  onKlik: () => void;
  ringkas: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border ${BINGKAI[status]}`}>
      <button type="button" onClick={onKlik} className="hover:bg-accent/50 flex w-full items-start gap-2 rounded-lg p-3 text-left" aria-expanded={terbuka}>
        <Titik status={status} />
        <div className="-mt-1 min-w-0 flex-1">
          <div className="text-sm font-medium">{judul}</div>
          <div className="text-muted-foreground mt-1 text-xs">{ringkas}</div>
        </div>
        <ChevronDown className={`text-muted-foreground size-4 shrink-0 transition-transform ${terbuka ? "rotate-180" : ""}`} />
      </button>
      {terbuka ? <div className="border-t px-3 py-2">{children}</div> : null}
    </div>
  );
}

export function PetaLayanan() {
  const [peta, setPeta] = useState<Peta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());

  const muat = useCallback(async () => {
    setSibuk(true);
    try {
      const res = await fetch("/api/admin/jobs/layanan", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(d.error ?? `HTTP ${res.status}`));
      setPeta(d as Peta);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "gagal memuat");
    } finally {
      setSibuk(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- muat() men-setState saat fetch; disengaja.
    void muat();
    // Muat ulang berkala hanya saat tab terlihat — tab latar tak membebani server.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void muat();
    }, MUAT_ULANG_MS);
    return () => clearInterval(t);
  }, [muat]);

  const balik = (k: string) =>
    setTerbuka((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const semua = [...(peta?.layanan ?? []), ...(peta?.job ?? [])];
  const hitung = (s: StatusLayanan) => semua.filter((x) => x.status === s).length;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="text-base">Peta Layanan</CardTitle>
        {peta ? (
          <>
            {(["MATI", "PERINGATAN", "OK"] as StatusLayanan[]).map((s) => (
              <Badge key={s} variant="outline" className="gap-1.5">
                <Titik status={s} /> {LABEL[s]} · {hitung(s)}
              </Badge>
            ))}
          </>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs">{peta ? `diperbarui ${jam(peta.sekarang)}` : ""}</span>
        <Button size="sm" variant="outline" onClick={() => void muat()} disabled={sibuk}>
          <RefreshCw className={`size-4 ${sibuk ? "animate-spin" : ""}`} /> Muat ulang
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {err ? <p className="text-destructive text-sm">{err}</p> : null}
        {!peta ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{sibuk ? "Memuat…" : "—"}</p>
        ) : (
          <>
            {!peta.sumber.pm2 || !peta.sumber.launchd ? (
              <p className="text-muted-foreground text-xs">
                Sumber tidak terbaca di server ini: {[!peta.sumber.pm2 && "pm2", !peta.sumber.launchd && "launchd"].filter(Boolean).join(" & ")}. Layanan dari sumber itu tidak ditampilkan.
              </p>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {peta.layanan.map((k) => (
                <Ubin
                  key={k.kunci}
                  judul={k.judul}
                  status={k.status}
                  terbuka={terbuka.has(k.kunci)}
                  onKlik={() => balik(k.kunci)}
                  ringkas={
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {k.anggota.length > 6 ? (
                        <span>
                          {k.anggota.filter((a) => a.status === "OK").length}/{k.anggota.length} normal
                        </span>
                      ) : (
                        k.anggota.map((a) => (
                          <span key={a.nama} className="inline-flex items-center gap-1">
                            <Titik status={a.status} /> {a.label}
                          </span>
                        ))
                      )}
                    </span>
                  }
                >
                  <ul className="space-y-1.5">
                    {k.anggota.map((a) => (
                      <li key={a.nama} className="flex items-start gap-2 text-xs">
                        <span className="mt-1">
                          <Titik status={a.status} />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {a.label} <span className="text-muted-foreground font-mono font-normal">{a.nama}</span>
                          </div>
                          <div className={a.status === "OK" ? "text-muted-foreground" : "text-destructive"}>{detailAnggota(a)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Ubin>
              ))}
            </div>

            {peta.job.length ? (
              <>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Job terjadwal per kelompok</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {peta.job.map((k) => (
                    <Ubin
                      key={`job-${k.kunci}`}
                      judul={k.judul}
                      status={k.status}
                      terbuka={terbuka.has(`job-${k.kunci}`)}
                      onKlik={() => balik(`job-${k.kunci}`)}
                      ringkas={
                        <>
                          {k.total} job · {k.ok} OK
                          {k.gagal ? <span className="text-destructive"> · {k.gagal} gagal</span> : null}
                          {k.terlewat ? <span className="text-amber-700 dark:text-amber-400"> · {k.terlewat} terlewat</span> : null}
                          {k.belum_jalan ? ` · ${k.belum_jalan} belum jalan` : null}
                          {k.nonaktif ? ` · ${k.nonaktif} nonaktif` : null}
                        </>
                      }
                    >
                      {k.bermasalah.length ? (
                        <p className="text-xs">
                          Bermasalah: <span className="font-mono">{k.bermasalah.join(", ")}</span>. Rinciannya di tabel di bawah.
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-xs">Semua job di kelompok ini normal.</p>
                      )}
                    </Ubin>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Dibaca langsung dari server (pm2 & launchd) dan diperbarui tiap menit selama halaman terbuka. Merah = proses mati, hilang, atau job gagal;
          kuning = job berkala keluar dengan kode ≠ 0 atau jadwal job terlewat.
        </p>
      </CardContent>
    </Card>
  );
}
