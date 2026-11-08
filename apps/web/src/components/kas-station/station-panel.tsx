"use client";

import { useState } from "react";
import { CalendarCheck, ClipboardList, Plus, Send, Wallet, TrendingDown } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";
import { CatatHarianDialog } from "./catat-dialog";
import { DetailHarianDialog, RiwayatHarian } from "./harian";
import { DetailRekapDialog, STATUS_VARIAN } from "./rekap";
import { useKasData } from "./use-kas-data";
import {
  NAMA_HARI, STATUS_LABEL, awalMinggu, hariIniWib, kasApi, labelMinggu, rp, rpSelisih, selCls, tambahHari, tgl, tglPendek,
  type Harian, type IzinKasStation, type Rekap, type RekapDetail,
} from "./types";

// F33 — layar station (kas cabang). Urutan dibuat mengikuti pekerjaan harian:
//   1. kartu ringkasan: saldo sekarang, hari ini sudah dicatat atau belum, minggu ini, rekap;
//   2. satu tombol utama: catat kas hari ini (atau tambah transaksi bila sudah ada catatan);
//   3. kalender minggu ini — hari mana yang sudah tercatat;
//   4. minggu yang siap diajukan: satu klik = buat rekap + ajukan ke pusat;
//   5. riwayat harian.
// Semua angka dihitung dari data yang sama dengan API (harian & rekap); tak ada aturan baru.

interface MingguTindakan { senin: string; rekap: Rekap | null; harian: Harian[] }

export function StationPanel({ izin, cabangOpsi }: { izin: IzinKasStation; cabangOpsi: string[] }) {
  const [pilih, setPilih] = useState("");
  const cabang = pilih || cabangOpsi[0] || "";
  const qsCabang = encodeURIComponent(cabang);
  const harian = useKasData<{ rows: Harian[] }>(cabang ? `harian?cabang=${qsCabang}&limit=200` : null);
  const rekap = useKasData<{ rows: Rekap[] }>(cabang ? `rekap?cabang=${qsCabang}&limit=200` : null);
  const muatUlang = () => { harian.muatUlang(); rekap.muatUlang(); };
  const { confirm, dialog } = useConfirm();
  const [catat, setCatat] = useState(false);
  const [detailHarian, setDetailHarian] = useState<string | null>(null);
  const [detailRekap, setDetailRekap] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rows = harian.data?.rows ?? [];
  const rekaps = rekap.data?.rows ?? [];
  const hariIni = hariIniWib();
  const senin = awalMinggu(hariIni);
  const terakhir = rows[0] ?? null; // API mengurutkan tanggal turun
  const catatanHariIni = rows.find((r) => r.tanggal === hariIni) ?? null;
  const mingguIni = rows.filter((r) => r.tanggal >= senin);
  const rekapPer = new Map(rekaps.map((r) => [r.periode_awal, r]));
  const rekapMingguIni = rekapPer.get(senin) ?? null;
  const tindakan: MingguTindakan[] = [...new Set(rows.map((r) => awalMinggu(r.tanggal)))]
    .filter((m) => m < senin)
    .sort().reverse()
    .map((m) => ({ senin: m, rekap: rekapPer.get(m) ?? null, harian: rows.filter((r) => awalMinggu(r.tanggal) === m) }))
    .filter((t) => !t.rekap || t.rekap.status === "draft" || t.rekap.status === "rejected");
  const ditolak = tindakan.filter((t) => t.rekap?.status === "rejected").length;
  const rekapTerakhir = rekaps.find((r) => r.status !== "draft") ?? null;

  const jumlah = (hs: Harian[]) => ({
    masuk: hs.reduce((a, h) => a + h.total_masuk, 0),
    keluar: hs.reduce((a, h) => a + h.total_keluar, 0),
  });
  const mi = jumlah(mingguIni);

  function ajukan(t: { senin: string; harian: Harian[]; rekap: Rekap | null }, lebihAwal = false) {
    const j = jumlah(t.harian);
    const akhir = [...t.harian].sort((a, b) => b.tanggal.localeCompare(a.tanggal))[0];
    confirm(
      {
        title: `${t.rekap?.status === "rejected" ? "Ajukan ulang" : "Ajukan"} rekap ${labelMinggu(t.senin)}?`,
        description: [
          `${t.harian.length} hari tercatat · masuk ${rp(j.masuk)} · keluar ${rp(j.keluar)} · saldo akhir ${akhir ? rp(akhir.saldo_akhir) : "—"}.`,
          lebihAwal ? "Minggu ini belum selesai: setelah diajukan, sisa hari minggu ini tidak bisa dicatat lagi sampai pusat memutuskan." : "Setelah diajukan, catatan minggu ini terkunci sampai pusat memutuskan.",
        ].join(" "),
        confirmLabel: "Ajukan ke pusat",
      },
      () => void (async () => {
        setBusy(t.senin); setErr(null);
        try {
          // Buat/segarkan rekap dari catatan harian terbaru, lalu langsung ajukan.
          const r = await kasApi<RekapDetail>("rekap", { method: "POST", body: { cabang, periode_awal: t.senin } });
          await kasApi(`rekap/${r.id}/submit`, { method: "POST", body: {} });
          muatUlang();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(null);
        }
      })(),
    );
  }

  const galat = harian.galat ?? rekap.galat;
  return (
    <div className="space-y-5">
      {cabangOpsi.length > 1 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ks-cabang">Station (cabang)</Label>
            <select id="ks-cabang" className={cn(selCls, "min-w-56 bg-card")} value={cabang} onChange={(e) => setPilih(e.target.value)}>
              {cabangOpsi.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      )}

      {!cabang ? (
        <EmptyState title="Akun Anda belum terhubung ke cabang" description="Minta admin mengisi cabang Anda di Data Karyawan, supaya kas station cabang itu bisa dicatat." />
      ) : galat ? (
        <EmptyState title="Data tidak dapat dimuat" description={galat} />
      ) : harian.loading && !harian.data ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : (
        <>
          {err && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Wallet} title="Saldo kas" value={terakhir ? rp(terakhir.saldo_akhir) : "—"}
              delta={terakhir ? `per ${tgl(terakhir.tanggal)}${terakhir.selisih ? ` · cek fisik ${rpSelisih(terakhir.selisih)}` : ""}` : "belum ada catatan"}
              deltaTone={terakhir?.selisih ? "negative" : "neutral"} />
            <StatCard icon={CalendarCheck} title="Hari ini" value={catatanHariIni ? "Sudah dicatat" : "Belum dicatat"}
              delta={catatanHariIni ? `${catatanHariIni.jumlah_transaksi} transaksi` : tglPendek(hariIni)}
              deltaTone={catatanHariIni ? "positive" : "negative"} />
            <StatCard icon={TrendingDown} title="Keluar minggu ini" value={rp(mi.keluar)}
              delta={`masuk ${rp(mi.masuk)} · ${mingguIni.length} dari 7 hari tercatat`} />
            <StatCard icon={ClipboardList} title="Rekap mingguan"
              value={tindakan.length ? `${tindakan.length} perlu diajukan` : rekapTerakhir ? STATUS_LABEL[rekapTerakhir.status] : "—"}
              delta={ditolak ? `${ditolak} ditolak pusat — perlu diperbaiki` : rekapTerakhir ? `terakhir ${labelMinggu(rekapTerakhir.periode_awal)}` : "belum ada rekap"}
              deltaTone={ditolak ? "negative" : "neutral"} />
          </div>

          {izin.stationCreate && (
            <div className="flex flex-wrap items-center gap-3">
              {catatanHariIni ? (
                catatanHariIni.bisa_diubah
                  ? <Button onClick={() => setDetailHarian(catatanHariIni.id)}><Plus /> Tambah transaksi hari ini</Button>
                  : <Button onClick={() => setDetailHarian(catatanHariIni.id)}>Lihat catatan hari ini</Button>
              ) : (
                <Button onClick={() => setCatat(true)}><Plus /> Catat kas hari ini</Button>
              )}
              {terakhir && catatanHariIni === null && terakhir.tanggal < tambahHari(hariIni, -1) && (
                <span className="text-muted-foreground text-sm">Catatan terakhir {tgl(terakhir.tanggal)} — hari yang terlewat bisa dicatat lewat tanggal di form.</span>
              )}
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold">Minggu ini · {labelMinggu(senin)}</CardTitle>
              {rekapMingguIni && rekapMingguIni.status !== "draft" ? (
                <button type="button" onClick={() => setDetailRekap(rekapMingguIni.id)}>
                  <Badge variant={STATUS_VARIAN[rekapMingguIni.status]}>{STATUS_LABEL[rekapMingguIni.status]}</Badge>
                </button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {NAMA_HARI.map((nama, i) => {
                  const t = tambahHari(senin, i);
                  const h = rows.find((r) => r.tanggal === t) ?? null;
                  const lalu = t < hariIni; const kini = t === hariIni;
                  const bisaKlik = !!h || (kini && izin.stationCreate);
                  return (
                    <button key={t} type="button" disabled={!bisaKlik}
                      onClick={() => (h ? setDetailHarian(h.id) : setCatat(true))}
                      className={cn("flex flex-col items-center gap-1 rounded-lg border bg-card px-1 py-2 text-xs transition-colors",
                        kini && "border-primary ring-1 ring-primary",
                        h && "hover:border-primary/60",
                        !h && !lalu && !kini && "opacity-50",
                        bisaKlik ? "cursor-pointer" : "cursor-default")}
                      aria-label={`${nama} ${tglPendek(t)}: ${h ? "tercatat" : lalu ? "tidak ada catatan" : kini ? "belum dicatat" : "belum tiba"}`}
                    >
                      <span className="text-muted-foreground font-medium">{nama}</span>
                      <span className="text-sm font-semibold">{Number(t.slice(8, 10))}</span>
                      <span className={cn("size-2.5 rounded-full",
                        h ? "bg-emerald-500" : lalu ? "border border-muted-foreground/50" : kini ? "bg-amber-500" : "bg-transparent")} />
                      <span className="hidden text-[10px] tabular-nums sm:block">
                        {h ? (h.total_keluar ? `−${(h.total_keluar / 1000).toLocaleString("id-ID")} rb` : "tanpa keluar") : kini ? "belum" : " "}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> tercatat</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" /> hari ini, belum dicatat</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-muted-foreground/50" /> tidak ada catatan</span>
                {izin.stationCreate && mingguIni.length > 0 && (!rekapMingguIni || rekapMingguIni.status === "draft" || rekapMingguIni.status === "rejected") && (
                  <button type="button" className="ml-auto underline-offset-2 hover:text-foreground hover:underline" disabled={busy !== null}
                    onClick={() => ajukan({ senin, harian: mingguIni, rekap: rekapMingguIni }, true)}>
                    Ajukan minggu ini lebih awal
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          {tindakan.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">Rekap yang perlu diajukan ke pusat</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {tindakan.map((t) => {
                  const j = jumlah(t.harian);
                  return (
                    <div key={t.senin} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
                      <div className="min-w-48">
                        <p className="font-medium">{labelMinggu(t.senin)}</p>
                        <p className="text-muted-foreground text-xs">{t.harian.length} dari 7 hari tercatat</p>
                      </div>
                      <div className="text-sm tabular-nums">
                        <span className="text-emerald-700 dark:text-emerald-400">+{rp(j.masuk)}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-red-700 dark:text-red-400">−{rp(j.keluar)}</span>
                      </div>
                      {t.rekap?.status === "rejected" && (
                        <p className="text-destructive min-w-0 flex-1 text-sm">
                          Ditolak pusat{t.rekap.decision_note ? `: “${t.rekap.decision_note}”` : ""}
                        </p>
                      )}
                      <div className="ml-auto flex gap-2">
                        {t.rekap && <Button size="sm" variant="soft" onClick={() => setDetailRekap(t.rekap!.id)}>Rincian</Button>}
                        {izin.stationCreate && (
                          <Button size="sm" disabled={busy !== null} onClick={() => ajukan(t)}>
                            <Send /> {busy === t.senin ? "Mengajukan…" : t.rekap?.status === "rejected" ? "Ajukan ulang" : "Ajukan"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Riwayat kas harian</h3>
            {rows.length === 0 ? (
              <EmptyState title="Belum ada catatan kas" description={izin.stationCreate ? "Mulai dengan tombol Catat kas hari ini. Catatan pertama mengisi saldo awal kas station." : "Station ini belum punya catatan."} />
            ) : (
              <RiwayatHarian rows={rows} onBuka={setDetailHarian} />
            )}
          </div>
        </>
      )}

      {catat && <CatatHarianDialog cabang={cabang} terakhir={terakhir} onClose={() => setCatat(false)} onSimpan={() => { setCatat(false); muatUlang(); }} />}
      {detailHarian && <DetailHarianDialog id={detailHarian} izin={izin} onClose={() => setDetailHarian(null)} onUbah={muatUlang} />}
      {detailRekap && <DetailRekapDialog id={detailRekap} izin={izin} onClose={() => setDetailRekap(null)} onUbah={muatUlang} />}
      {dialog}
    </div>
  );
}
