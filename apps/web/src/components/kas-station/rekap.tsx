"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";
import { useKasData } from "./use-kas-data";
import {
  STATUS_LABEL, kasApi, rp, rpSelisih, selCls, tgl, waktu,
  type IzinKasStation, type Rekap, type RekapDetail, type StatusRekap,
} from "./types";

export const STATUS_VARIAN: Record<StatusRekap, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default", rejected: "destructive",
};
const selisihCls = (n: number) => (n === 0 ? "" : n < 0 ? "text-destructive font-semibold" : "text-amber-600 font-semibold");

export function RiwayatRekap({ izin, cabangOpsi }: { izin: IzinKasStation; cabangOpsi: string[] }) {
  const [cabang, setCabang] = useState("");
  const [status, setStatus] = useState("");
  const qs = new URLSearchParams({ limit: "200" });
  if (cabang) qs.set("cabang", cabang);
  if (status) qs.set("status", status);
  const { data, galat, loading, muatUlang } = useKasData<{ rows: Rekap[] }>(`rekap?${qs.toString()}`);
  const [detailId, setDetailId] = useState<string | null>(null);
  const rows = data?.rows ?? [];

  const kolom: DataColumn<Rekap>[] = [
    { id: "cabang", header: "Station", sortable: true, accessor: (r) => r.cabang },
    { id: "periode", header: "Periode", sortable: true, accessor: (r) => r.periode_awal, cell: (r) => `${tgl(r.periode_awal)} – ${tgl(r.periode_akhir)}` },
    { id: "hari", header: "Hari", align: "right", searchable: false, accessor: (r) => r.jumlah_hari },
    { id: "masuk", header: "Masuk", align: "right", searchable: false, accessor: (r) => r.total_masuk, cell: (r) => rp(r.total_masuk) },
    { id: "keluar", header: "Keluar", align: "right", searchable: false, accessor: (r) => r.total_keluar, cell: (r) => rp(r.total_keluar) },
    { id: "akhir", header: "Saldo akhir", align: "right", sortable: true, searchable: false, accessor: (r) => r.saldo_akhir, cell: (r) => <span className="font-medium">{rp(r.saldo_akhir)}</span> },
    {
      id: "selisih", header: "Selisih", align: "right", searchable: false, accessor: (r) => r.total_selisih,
      cell: (r) => <span className={selisihCls(r.total_selisih)}>{r.jumlah_hari_selisih === 0 && r.total_selisih === 0 ? "Cocok" : rpSelisih(r.total_selisih)}</span>,
    },
    {
      id: "status", header: "Status", sortable: true, accessor: (r) => STATUS_LABEL[r.status],
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant={STATUS_VARIAN[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.realisasi_at && <Badge variant="outline">Direalisasi</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="kr-cabang">Station</Label>
          <select id="kr-cabang" className={cn(selCls, "min-w-40")} value={cabang} onChange={(e) => setCabang(e.target.value)}>
            <option value="">Semua</option>{cabangOpsi.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div className="space-y-1"><Label htmlFor="kr-status">Status</Label>
          <select id="kr-status" className={cn(selCls, "min-w-40")} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua</option>
            {(Object.keys(STATUS_LABEL) as StatusRekap[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></div>
      </div>

      {galat ? (
        <EmptyState title="Data tidak dapat dimuat" description={galat} />
      ) : loading && !data ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada rekap" description="Belum ada rekap yang cocok dengan filter." />
      ) : (
        <DataTable columns={kolom} data={rows} getKey={(r) => r.id} pageSize={10} initialSort={{ id: "periode", dir: "desc" }}
          searchPlaceholder="Cari station…" onRowClick={(r) => setDetailId(r.id)} />
      )}

      {detailId && <DetailRekapDialog id={detailId} izin={izin} onClose={() => setDetailId(null)} onUbah={muatUlang} />}
    </div>
  );
}

export function DetailRekapDialog({ id, izin, onClose, onUbah }: { id: string; izin: IzinKasStation; onClose: () => void; onUbah: () => void }) {
  const { data: r, galat, loading, muatUlang } = useKasData<RekapDetail>(`rekap/${encodeURIComponent(id)}`);
  const { confirm, dialog } = useConfirm();
  const [tolak, setTolak] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [nominal, setNominal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function jalankan(path: string, body: unknown, selesai?: () => void) {
    setBusy(true); setErr(null);
    try { await kasApi(`rekap/${id}/${path}`, { method: "POST", body }); muatUlang(); onUbah(); selesai?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const bisaAjukan = !!r && izin.stationCreate && (r.status === "draft" || r.status === "rejected");
  const bisaPutuskan = !!r && izin.reviewEdit && r.status === "submitted";
  const bisaRealisasi = !!r && izin.reviewEdit && r.status === "approved" && !r.realisasi_at;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{r ? `Rekap ${r.cabang} — ${tgl(r.periode_awal)} s/d ${tgl(r.periode_akhir)}` : "Detail rekap"}</DialogTitle>
          <DialogDescription>Roll-up otomatis dari kas harian. Pusat hanya meninjau dan memutuskan — tidak ada input ulang.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {galat && <p role="alert" className="text-destructive text-sm">{galat}</p>}
          {err && <p role="alert" className="text-destructive text-sm">{err}</p>}
          {!r ? (loading ? <p className="text-muted-foreground text-sm">Memuat…</p> : null) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIAN[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                {r.realisasi_at && <Badge variant="outline">Dana direalisasikan</Badge>}
                {r.submit_count > 1 && <span className="text-muted-foreground text-xs">diajukan {r.submit_count}×</span>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Saldo awal</dt><dd className="tabular-nums">{rp(r.saldo_awal)}</dd></div>
                <div><dt className="text-muted-foreground">Total masuk</dt><dd className="tabular-nums">{rp(r.total_masuk)}</dd></div>
                <div><dt className="text-muted-foreground">Total keluar</dt><dd className="tabular-nums">{rp(r.total_keluar)}</dd></div>
                <div><dt className="text-muted-foreground">Saldo akhir</dt><dd className="font-semibold tabular-nums">{rp(r.saldo_akhir)}</dd></div>
                <div><dt className="text-muted-foreground">Hari tercatat</dt><dd>{r.jumlah_hari} dari 7</dd></div>
                <div><dt className="text-muted-foreground">Total selisih</dt>
                  <dd className={cn("tabular-nums", selisihCls(r.total_selisih))}>{r.jumlah_hari_selisih === 0 && r.total_selisih === 0 ? "Cocok" : `${rp(r.total_selisih)} (${r.jumlah_hari_selisih} hari)`}</dd></div>
              </dl>

              {r.status === "draft" || r.status === "rejected" ? (
                <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
                  Angka ini snapshot sementara; saat diajukan, sistem menghitung ulang dari catatan harian terbaru.
                </p>
              ) : null}
              {r.hari_tanpa_catatan.length > 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                  Tanggal tanpa catatan kas: {r.hari_tanpa_catatan.map((t) => tgl(t)).join(", ")}.
                </p>
              )}
              {r.status === "rejected" && r.decision_note && (
                <p role="status" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                  <strong>Ditolak{r.decided_by ? ` oleh ${r.decided_by}` : ""}:</strong> {r.decision_note}
                </p>
              )}
              {r.decided_at && r.status === "approved" && (
                <p className="text-muted-foreground text-sm">Disetujui {r.decided_by ?? ""} · {waktu(r.decided_at)}{r.decision_note ? ` · “${r.decision_note}”` : ""}</p>
              )}
              {r.realisasi_at && r.realisasi_nominal !== null && (
                <p className="text-sm"><strong>Realisasi {rp(r.realisasi_nominal)}</strong> <span className="text-muted-foreground">· {r.realisasi_by ?? ""} · {waktu(r.realisasi_at)}</span></p>
              )}
              {r.submitted_at && <p className="text-muted-foreground text-xs">Diajukan {r.submitted_by ?? ""} · {waktu(r.submitted_at)}</p>}

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs"><tr>
                    <th className="px-3 py-2 text-left font-medium">Tanggal</th><th className="px-3 py-2 text-right font-medium">Awal</th>
                    <th className="px-3 py-2 text-right font-medium">Masuk</th><th className="px-3 py-2 text-right font-medium">Keluar</th>
                    <th className="px-3 py-2 text-right font-medium">Akhir</th><th className="px-3 py-2 text-right font-medium">Selisih</th></tr></thead>
                  <tbody>
                    {r.harian.map((h) => (
                      <tr key={h.id} className="border-t align-top">
                        <td className="px-3 py-2 whitespace-nowrap">{tgl(h.tanggal)}
                          {h.transaksi.length > 0 && (
                            <ul className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                              {h.transaksi.map((t) => <li key={t.id}>{t.jenis === "masuk" ? "＋" : "−"} {t.uraian}{t.bukti_ref ? ` (${t.bukti_ref})` : ""} · {rp(t.nominal)}</li>)}
                            </ul>
                          )}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rp(h.saldo_awal)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rp(h.total_masuk)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{rp(h.total_keluar)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">{rp(h.saldo_akhir)}</td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", h.selisih !== null && selisihCls(h.selisih))}>{h.selisih === null ? "—" : rpSelisih(h.selisih)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bisaPutuskan && tolak && (
                <div className="space-y-2 rounded-md border p-3">
                  <Label htmlFor="kr-alasan">Alasan penolakan * (agar station tahu apa yang diperbaiki)</Label>
                  <Textarea id="kr-alasan" maxLength={1000} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={busy || !alasan.trim()}
                      onClick={() => void jalankan("decide", { decision: "reject", note: alasan.trim() }, () => { setTolak(false); setAlasan(""); })}>Tolak rekap</Button>
                    <Button size="sm" variant="ghost" onClick={() => setTolak(false)}>Batal</Button>
                  </div>
                </div>
              )}
              {bisaRealisasi && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="space-y-1"><Label htmlFor="kr-realisasi">Nominal dana yang direalisasikan *</Label>
                    <CurrencyInput id="kr-realisasi" value={nominal} onChange={setNominal} /></div>
                  <Button size="sm" disabled={busy || !nominal || Number(nominal) <= 0}
                    onClick={() => confirm({ title: "Catat realisasi dana?", description: `${rp(Number(nominal))} ke station ${r.cabang}. Tidak bisa diubah setelah dicatat.`, confirmLabel: "Catat realisasi" },
                      () => void jalankan("realisasi", { realisasi_nominal: Number(nominal) }, () => setNominal("")))}>Catat realisasi</Button>
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {bisaAjukan && (
            <Button disabled={busy} onClick={() => confirm({ title: "Ajukan rekap ke pusat?", description: "Setelah diajukan, catatan kas pada minggu ini terkunci sampai pusat memutuskan.", confirmLabel: "Ajukan" },
              () => void jalankan("submit", {}))}>{r?.status === "rejected" ? "Ajukan ulang" : "Ajukan ke pusat"}</Button>
          )}
          {bisaPutuskan && !tolak && (
            <>
              <Button variant="soft" disabled={busy} onClick={() => setTolak(true)}>Tolak…</Button>
              <Button disabled={busy} onClick={() => confirm({ title: "Setujui rekap ini?", description: "Setelah disetujui, dana dapat direalisasikan ke station.", confirmLabel: "Setujui" },
                () => void jalankan("decide", { decision: "approve" }))}>Setujui</Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>Tutup</Button>
        </DialogFooter>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
