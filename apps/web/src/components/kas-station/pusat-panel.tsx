"use client";

import { useState } from "react";
import { Banknote, Building2, Check, Inbox, Wallet, X } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";
import { DetailRekapDialog, RiwayatRekap } from "./rekap";
import { useKasData } from "./use-kas-data";
import {
  hariIniWib, kasApi, labelMinggu, rp, rpSelisih, selisihHari, tgl, waktu,
  type IzinKasStation, type Rekap, type RingkasanStation,
} from "./types";

// F33 — layar pusat. Yang perlu diputuskan tampil paling atas (kotak masuk rekap "Menunggu
// review"), lalu rekap disetujui yang dananya belum direalisasi, lalu kondisi semua station,
// lalu riwayat lengkap. Pengaju ≠ penyetuju tetap ditegakkan API (403 → pesan galat).

export function PusatPanel({ izin, cabangOpsi }: { izin: IzinKasStation; cabangOpsi: string[] }) {
  const ring = useKasData<{ rows: RingkasanStation[] }>("ringkasan");
  const tunggu = useKasData<{ rows: Rekap[] }>("rekap?status=submitted&limit=200");
  const setuju = useKasData<{ rows: Rekap[] }>("rekap?status=approved&limit=200");
  const [versiRiwayat, setVersiRiwayat] = useState(0);
  const muatUlang = () => { ring.muatUlang(); tunggu.muatUlang(); setuju.muatUlang(); setVersiRiwayat((v) => v + 1); };
  const { confirm, dialog } = useConfirm();
  const [detail, setDetail] = useState<string | null>(null);
  const [tolak, setTolak] = useState<Rekap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const stations = ring.data?.rows ?? [];
  const menunggu = [...(tunggu.data?.rows ?? [])].sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const belumRealisasi = (setuju.data?.rows ?? []).filter((r) => !r.realisasi_at);
  const hariIni = hariIniWib();
  const aktif = stations.filter((s) => s.hari_7 > 0).length;
  const mulai = stations.filter((s) => s.tanggal_terakhir !== null);
  const totalSaldo = mulai.reduce((a, s) => a + (s.saldo_akhir ?? 0), 0);

  async function putuskan(r: Rekap, body: { decision: "approve" } | { decision: "reject"; note: string }) {
    setBusy(r.id); setErr(null);
    try {
      await kasApi(`rekap/${r.id}/decide`, { method: "POST", body });
      setTolak(null);
      muatUlang();
    } catch (e) {
      setErr(`${r.cabang} ${labelMinggu(r.periode_awal)}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const kolom: DataColumn<RingkasanStation>[] = [
    { id: "cabang", header: "Station", sortable: true, accessor: (s) => s.cabang, cell: (s) => <span className="font-medium">{s.cabang}</span> },
    {
      id: "terakhir", header: "Catatan terakhir", sortable: true, searchable: false, accessor: (s) => s.tanggal_terakhir ?? "",
      cell: (s) => {
        if (!s.tanggal_terakhir) return <span className="text-muted-foreground">belum mulai</span>;
        const n = selisihHari(s.tanggal_terakhir, hariIni);
        return (
          <span className="inline-flex items-center gap-2">
            {tgl(s.tanggal_terakhir)}
            <span className={cn("text-xs", n > 3 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{n === 0 ? "hari ini" : `${n} hari lalu`}</span>
          </span>
        );
      },
    },
    { id: "aktif", header: "7 hari terakhir", align: "right", sortable: true, searchable: false, accessor: (s) => s.hari_7, cell: (s) => `${s.hari_7} hari` },
    { id: "saldo", header: "Saldo kas", align: "right", sortable: true, searchable: false, accessor: (s) => s.saldo_akhir ?? -1, cell: (s) => (s.saldo_akhir === null ? "—" : <span className="font-medium">{rp(s.saldo_akhir)}</span>) },
    {
      id: "fisik", header: "Cek fisik", align: "right", searchable: false, accessor: (s) => s.selisih ?? 0,
      cell: (s) => (s.selisih === null ? <span className="text-muted-foreground">—</span> : <span className={cn(s.selisih !== 0 && "font-semibold text-amber-700 dark:text-amber-400")}>{rpSelisih(s.selisih)}</span>),
    },
    {
      id: "rekap", header: "Rekap", searchable: false, accessor: (s) => s.rekap_menunggu * 100 + s.rekap_belum_realisasi * 10 + s.rekap_ditolak,
      cell: (s) => (
        <span className="flex flex-wrap gap-1">
          {s.rekap_menunggu > 0 && <Badge variant="secondary">{s.rekap_menunggu} menunggu</Badge>}
          {s.rekap_belum_realisasi > 0 && <Badge variant="outline">{s.rekap_belum_realisasi} belum realisasi</Badge>}
          {s.rekap_ditolak > 0 && <Badge variant="destructive">{s.rekap_ditolak} ditolak</Badge>}
          {s.rekap_menunggu + s.rekap_belum_realisasi + s.rekap_ditolak === 0 && <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {err && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Inbox} title="Menunggu tinjauan" value={String(menunggu.length)}
          delta={menunggu.length ? `tertua diajukan ${waktu(menunggu[0].submitted_at)}` : "tidak ada antrean"} deltaTone={menunggu.length ? "negative" : "positive"} />
        <StatCard icon={Banknote} title="Disetujui, belum direalisasi" value={String(belumRealisasi.length)}
          delta={belumRealisasi.length ? "catat realisasi dana di bawah" : "semua sudah direalisasi"} />
        <StatCard icon={Building2} title="Station aktif (7 hari)" value={`${aktif} / ${stations.length}`}
          delta={`${stations.length - mulai.length} station belum mulai mencatat`} />
        <StatCard icon={Wallet} title="Total saldo kas station" value={rp(totalSaldo)} delta={`${mulai.length} station tercatat`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base font-semibold">Perlu ditinjau ({menunggu.length})</CardTitle></CardHeader>
        <CardContent className={cn(menunggu.length > 0 && "divide-y p-0")}>
          {tunggu.galat ? <p className="text-destructive text-sm">{tunggu.galat}</p>
            : tunggu.loading && !tunggu.data ? <p className="text-muted-foreground text-sm">Memuat…</p>
            : menunggu.length === 0 ? <p className="text-muted-foreground text-sm">Tidak ada rekap yang menunggu keputusan.</p>
            : menunggu.map((r) => (
              <div key={r.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[minmax(12rem,1fr)_2fr_auto] lg:items-center">
                <div>
                  <p className="font-semibold">{r.cabang}</p>
                  <p className="text-muted-foreground text-xs">{labelMinggu(r.periode_awal)} · {r.jumlah_hari} dari 7 hari{r.submit_count > 1 ? ` · diajukan ${r.submit_count}×` : ""}</p>
                  <p className="text-muted-foreground text-xs">oleh {r.submitted_by ?? "—"} · {waktu(r.submitted_at)}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div><dt className="text-muted-foreground text-xs">Masuk</dt><dd className="text-emerald-700 tabular-nums dark:text-emerald-400">+{rp(r.total_masuk)}</dd></div>
                  <div><dt className="text-muted-foreground text-xs">Keluar</dt><dd className="text-red-700 tabular-nums dark:text-red-400">−{rp(r.total_keluar)}</dd></div>
                  <div><dt className="text-muted-foreground text-xs">Saldo akhir</dt><dd className="font-medium tabular-nums">{rp(r.saldo_akhir)}</dd></div>
                  <div><dt className="text-muted-foreground text-xs">Cek fisik</dt>
                    <dd className={cn("tabular-nums", r.total_selisih !== 0 && "font-semibold text-amber-700 dark:text-amber-400")}>
                      {r.jumlah_hari_selisih === 0 && r.total_selisih === 0 ? "Cocok" : `${rpSelisih(r.total_selisih)} (${r.jumlah_hari_selisih} hari)`}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button size="sm" variant="soft" onClick={() => setDetail(r.id)}>Rincian</Button>
                  {izin.reviewEdit && (
                    <>
                      <Button size="sm" variant="soft" disabled={busy !== null} onClick={() => setTolak(r)}><X /> Tolak</Button>
                      <Button size="sm" disabled={busy !== null}
                        onClick={() => confirm({ title: `Setujui rekap ${r.cabang}?`, description: `${labelMinggu(r.periode_awal)} · keluar ${rp(r.total_keluar)} · saldo akhir ${rp(r.saldo_akhir)}. Setelah disetujui, dana bisa direalisasikan.`, confirmLabel: "Setujui" },
                          () => void putuskan(r, { decision: "approve" }))}>
                        <Check /> {busy === r.id ? "Memproses…" : "Setujui"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
        </CardContent>
      </Card>

      {belumRealisasi.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base font-semibold">Disetujui, dana belum direalisasi ({belumRealisasi.length})</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {belumRealisasi.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
                <div className="min-w-48">
                  <p className="font-medium">{r.cabang}</p>
                  <p className="text-muted-foreground text-xs">{labelMinggu(r.periode_awal)} · disetujui {waktu(r.decided_at)}</p>
                </div>
                <p className="text-sm tabular-nums">keluar <span className="text-red-700 dark:text-red-400">{rp(r.total_keluar)}</span> · saldo akhir {rp(r.saldo_akhir)}</p>
                {izin.reviewEdit && <Button size="sm" className="ml-auto" onClick={() => setDetail(r.id)}><Banknote /> Catat realisasi</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Kartu putih: tanpa kartu, tabel menyatu dengan latar halaman (--background). */}
      <Card>
        <CardHeader><CardTitle className="text-base font-semibold">Semua station</CardTitle></CardHeader>
        <CardContent>
          {ring.galat ? <p className="text-destructive text-sm">{ring.galat}</p>
            : ring.loading && !ring.data ? <p className="text-muted-foreground text-sm">Memuat…</p>
            : <DataTable columns={kolom} data={stations} getKey={(s) => s.cabang} initialSort={{ id: "cabang", dir: "asc" }} searchPlaceholder="Cari station…" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base font-semibold">Riwayat rekap</CardTitle></CardHeader>
        <CardContent>
          <RiwayatRekap key={versiRiwayat} izin={izin} cabangOpsi={cabangOpsi} />
        </CardContent>
      </Card>

      {detail && <DetailRekapDialog id={detail} izin={izin} onClose={() => setDetail(null)} onUbah={muatUlang} />}
      {tolak && <TolakDialog r={tolak} busy={busy === tolak.id} onClose={() => setTolak(null)} onTolak={(note) => void putuskan(tolak, { decision: "reject", note })} />}
      {dialog}
    </div>
  );
}

function TolakDialog({ r, busy, onClose, onTolak }: { r: Rekap; busy: boolean; onClose: () => void; onTolak: (note: string) => void }) {
  const [alasan, setAlasan] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tolak rekap {r.cabang}</DialogTitle>
          <DialogDescription>{labelMinggu(r.periode_awal)}. Tulis apa yang perlu diperbaiki — station melihat alasan ini dan bisa mengajukan ulang.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <Label htmlFor="kt-alasan">Alasan *</Label>
          <Textarea id="kt-alasan" maxLength={1000} autoFocus value={alasan} onChange={(e) => setAlasan(e.target.value)}
            placeholder="mis. nota transaksi 5 Nov belum dilampirkan nomornya" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button variant="destructive" disabled={busy || !alasan.trim()} onClick={() => onTolak(alasan.trim())}>{busy ? "Memproses…" : "Tolak rekap"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
