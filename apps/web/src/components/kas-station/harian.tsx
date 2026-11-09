"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";
import { TrxInput, trxKosong, type BarisTrx } from "./trx-input";
import { useKasData } from "./use-kas-data";
import { hariIniWib, kasApi, rp, rpSelisih, tambahHari, tgl, type Harian, type HarianDetail, type IzinKasStation } from "./types";

// F33 — riwayat kas harian satu station (tabel) + dialog detail/ubah satu hari.

export const selisihCls = (n: number | null) => (n === null || n === 0 ? "" : n < 0 ? "text-destructive font-semibold" : "text-amber-600 font-semibold");

export function RiwayatHarian({ rows, onBuka }: { rows: Harian[]; onBuka: (id: string) => void }) {
  const kolom: DataColumn<Harian>[] = [
    { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => r.tanggal, cell: (r) => tgl(r.tanggal) },
    { id: "trx", header: "Transaksi", align: "right", searchable: false, accessor: (r) => r.jumlah_transaksi },
    { id: "masuk", header: "Masuk", align: "right", searchable: false, accessor: (r) => r.total_masuk,
      cell: (r) => (r.total_masuk ? <span className="text-emerald-700 dark:text-emerald-400">+{rp(r.total_masuk)}</span> : <span className="text-muted-foreground">—</span>) },
    { id: "keluar", header: "Keluar", align: "right", searchable: false, accessor: (r) => r.total_keluar,
      cell: (r) => (r.total_keluar ? <span className="text-red-700 dark:text-red-400">−{rp(r.total_keluar)}</span> : <span className="text-muted-foreground">—</span>) },
    { id: "akhir", header: "Saldo akhir", align: "right", sortable: true, searchable: false, accessor: (r) => r.saldo_akhir, cell: (r) => <span className="font-medium">{rp(r.saldo_akhir)}</span> },
    {
      id: "selisih", header: "Cek fisik", align: "right", searchable: false, accessor: (r) => r.selisih ?? 0,
      cell: (r) => (r.selisih === null ? <span className="text-muted-foreground">—</span> : <span className={selisihCls(r.selisih)}>{rpSelisih(r.selisih)}</span>),
    },
    {
      id: "status", header: "", searchable: false, accessor: (r) => (r.terkunci ? "terkunci" : ""),
      cell: (r) => (r.terkunci ? <Badge variant="secondary">Sudah diajukan</Badge> : null),
    },
  ];
  return (
    <DataTable columns={kolom} data={rows} getKey={(r) => r.id} pageSize={10} initialSort={{ id: "tanggal", dir: "desc" }}
      searchPlaceholder="Cari tanggal…" onRowClick={(r) => onBuka(r.id)} />
  );
}

// ── Detail & ubah ───────────────────────────────────────────────────────────

export function DetailHarianDialog({ id, izin, rows = [], batas = null, onClose, onUbah, onBuka }: {
  id: string; izin: IzinKasStation;
  /** Catatan station (urut turun) & batas kunci rekap — untuk memilih tanggal transaksi. */
  rows?: Harian[]; batas?: string | null;
  onClose: () => void; onUbah: () => void;
  /** Pindah ke catatan lain (dipakai saat transaksi ditambahkan ke tanggal sesudahnya → catatan baru). */
  onBuka?: (id: string) => void;
}) {
  const { data: h, galat, loading, muatUlang } = useKasData<HarianDetail>(`harian/${encodeURIComponent(id)}`);
  const { confirm, dialog } = useConfirm();
  const [baru, setBaru] = useState<BarisTrx>(trxKosong());
  const [tglBaru, setTglBaru] = useState<string | null>(null);
  const [fisik, setFisik] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function jalankan(fn: () => Promise<unknown>, selesai?: () => void) {
    setBusy(true); setErr(null);
    try { await fn(); muatUlang(); onUbah(); selesai?.(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const ubahBolehTulis = !!h && h.bisa_diubah;
  const alasanKunci = !h ? "" : h.terkunci
    ? "Minggu ini sudah diajukan ke pusat — catatan terkunci."
    : !h.bisa_diubah ? "Minggu ini atau sesudahnya sudah diajukan ke pusat — catatan terkunci." : "";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{h ? `${h.cabang} — ${tgl(h.tanggal)}` : "Detail kas harian"}</DialogTitle>
          <DialogDescription>Saldo akhir dihitung sistem: saldo awal + masuk − keluar.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {galat && <p role="alert" className="text-destructive text-sm">{galat}</p>}
          {err && <p role="alert" className="text-destructive text-sm">{err}</p>}
          {!h ? (loading ? <p className="text-muted-foreground text-sm">Memuat…</p> : null) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">Saldo awal</dt><dd className="tabular-nums">{rp(h.saldo_awal)}</dd></div>
                <div><dt className="text-muted-foreground">Masuk</dt><dd className="tabular-nums">{rp(h.total_masuk)}</dd></div>
                <div><dt className="text-muted-foreground">Keluar</dt><dd className="tabular-nums">{rp(h.total_keluar)}</dd></div>
                <div><dt className="text-muted-foreground">Saldo akhir</dt><dd className="font-semibold tabular-nums">{rp(h.saldo_akhir)}</dd></div>
                <div><dt className="text-muted-foreground">Saldo fisik</dt><dd className="tabular-nums">{h.saldo_fisik === null ? "—" : rp(h.saldo_fisik)}</dd></div>
                <div><dt className="text-muted-foreground">Selisih</dt>
                  <dd className={cn("tabular-nums", selisihCls(h.selisih))}>{h.selisih === null ? "—" : rpSelisih(h.selisih)}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Keterangan</dt><dd>{h.keterangan ?? "—"}</dd></div>
              </dl>

              {alasanKunci && <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">{alasanKunci}</p>}

              <div className="space-y-2">
                <Label>Transaksi ({h.transaksi.length})</Label>
                {h.transaksi.length === 0 ? <p className="text-muted-foreground text-sm">Tidak ada transaksi.</p> : (
                  <ul className="divide-y rounded-md border text-sm">
                    {h.transaksi.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                        <span className={cn("w-14 shrink-0 text-xs font-semibold", t.jenis === "masuk" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>{t.jenis === "masuk" ? "Masuk" : "Keluar"}</span>
                        <span className="min-w-0 flex-1 truncate">{t.uraian}{t.bukti_ref ? <span className="text-muted-foreground"> · {t.bukti_ref}</span> : null}</span>
                        <span className="tabular-nums">{t.jenis === "masuk" ? "+" : "−"}{rp(t.nominal)}</span>
                        {ubahBolehTulis && izin.stationDelete && (
                          <Button size="icon-sm" variant="ghost" aria-label="Hapus transaksi" disabled={busy}
                            onClick={() => confirm({ title: "Hapus transaksi ini?", description: `${t.uraian} — ${rp(t.nominal)}`, destructive: true, confirmLabel: "Hapus" },
                              () => void jalankan(() => kasApi(`harian/${id}/transaksi/${t.id}`, { method: "DELETE" })))}><Trash2 /></Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {ubahBolehTulis && izin.stationCreate && (() => {
                // Tanggal transaksi bebas (rapel) antara batas kunci rekap / catatan pertama dan hari ini.
                // Tanggal yang sudah punya catatan → transaksi masuk ke catatan itu; tanggal kosong →
                // catatan baru. Saldo hari sesudahnya dihitung ulang oleh API.
                const tanggalTrx = tglBaru ?? h.tanggal;
                const tertua = rows.length ? rows[rows.length - 1].tanggal : h.tanggal;
                const tglMin = [batas ? tambahHari(batas, 1) : null, tertua < h.tanggal ? tertua : h.tanggal].filter((x): x is string => !!x).sort().pop();
                const tujuan = tanggalTrx === h.tanggal ? h : rows.find((r) => r.tanggal === tanggalTrx) ?? null;
                const hariBaru = tujuan === null;
                const sebelum = rows.find((r) => r.tanggal < tanggalTrx) ?? null;
                const siap = !!baru.nominal && Number(baru.nominal) > 0 && !!baru.uraian.trim();
                const trxBody = { jenis: baru.jenis, nominal: Number(baru.nominal), uraian: baru.uraian.trim(), bukti_ref: baru.bukti_ref.trim() || undefined };
                return (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <Label>Tambah transaksi</Label>
                      <div className="flex items-center gap-2">
                        <Label htmlFor="kd-tgl" className="text-muted-foreground text-xs font-normal">Tanggal</Label>
                        <Input id="kd-tgl" type="date" className="h-8 w-40" min={tglMin} max={hariIniWib()} value={tanggalTrx}
                          onChange={(e) => setTglBaru(e.target.value && (!tglMin || e.target.value >= tglMin) ? e.target.value : h.tanggal)} />
                      </div>
                    </div>
                    <TrxInput b={baru} onChange={(p) => setBaru({ ...baru, ...p })} />
                    {tanggalTrx !== h.tanggal && (
                      <p className="text-muted-foreground text-xs">
                        {hariBaru
                          ? `Akan dibuat catatan baru ${tgl(tanggalTrx)}${sebelum ? ` dengan saldo awal ${rp(sebelum.saldo_akhir)}` : ""}.`
                          : `Transaksi masuk ke catatan ${tgl(tanggalTrx)}.`}
                        {" "}Saldo hari-hari sesudahnya ikut dihitung ulang.
                      </p>
                    )}
                    <Button size="sm" disabled={busy || !siap}
                      onClick={() => void jalankan(
                        async () => {
                          if (tujuan) {
                            const r = await kasApi(`harian/${tujuan.id}/transaksi`, { method: "POST", body: trxBody });
                            if (tujuan.id !== id) onBuka?.(tujuan.id);
                            return r;
                          }
                          const r = await kasApi<{ id: string }>("harian", { method: "POST", body: { cabang: h.cabang, tanggal: tanggalTrx, transaksi: [trxBody] } });
                          onBuka?.(r.id);
                          return r;
                        },
                        () => { setBaru(trxKosong()); setTglBaru(null); },
                      )}><Plus /> {tanggalTrx !== h.tanggal ? `Tambah ke ${tgl(tanggalTrx)}` : "Tambah"}</Button>
                  </div>
                );
              })()}

              {ubahBolehTulis && izin.stationEdit && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="space-y-1"><Label htmlFor="kd-fisik">Uang fisik di laci (cek selisih)</Label>
                    <CurrencyInput id="kd-fisik" value={fisik ?? (h.saldo_fisik === null ? "" : String(h.saldo_fisik))} onChange={setFisik} /></div>
                  <Button size="sm" variant="soft" disabled={busy || fisik === null}
                    onClick={() => void jalankan(() => kasApi(`harian/${id}`, { method: "PATCH", body: { saldo_fisik: fisik === "" ? null : Number(fisik) } }), () => setFisik(null))}>
                    Simpan</Button>
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {ubahBolehTulis && izin.stationDelete && (
            <Button variant="destructive" disabled={busy} className="sm:mr-auto"
              onClick={() => confirm({ title: "Hapus catatan kas hari ini?", description: "Seluruh transaksi di hari ini ikut terhapus.", destructive: true, confirmLabel: "Hapus" },
                () => void jalankan(() => kasApi(`harian/${id}`, { method: "DELETE" }), onClose))}>Hapus catatan</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Tutup</Button>
        </DialogFooter>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
