"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";
import { useKasData } from "./use-kas-data";
import {
  hariIniWib, kasApi, rp, selCls, tgl,
  type Harian, type HarianDetail, type IzinKasStation, type JenisTransaksi,
} from "./types";

interface BarisTrx { jenis: JenisTransaksi; nominal: string; uraian: string; bukti_ref: string }
const trxKosong = (): BarisTrx => ({ jenis: "keluar", nominal: "", uraian: "", bukti_ref: "" });

const selisihCls = (n: number | null) => (n === null || n === 0 ? "" : n < 0 ? "text-destructive font-semibold" : "text-amber-600 font-semibold");

export function HarianTab({ izin, cabangOpsi }: { izin: IzinKasStation; cabangOpsi: string[] }) {
  const [pilih, setPilih] = useState("");
  const cabang = pilih || cabangOpsi[0] || "";
  const { data, galat, loading, muatUlang } = useKasData<{ rows: Harian[] }>(cabang ? `harian?cabang=${encodeURIComponent(cabang)}&limit=200` : null);
  const [tambah, setTambah] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const rows = data?.rows ?? [];

  const kolom: DataColumn<Harian>[] = [
    { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => r.tanggal, cell: (r) => tgl(r.tanggal) },
    { id: "awal", header: "Saldo awal", align: "right", sortable: true, searchable: false, accessor: (r) => r.saldo_awal, cell: (r) => rp(r.saldo_awal) },
    { id: "masuk", header: "Masuk", align: "right", searchable: false, accessor: (r) => r.total_masuk, cell: (r) => rp(r.total_masuk) },
    { id: "keluar", header: "Keluar", align: "right", searchable: false, accessor: (r) => r.total_keluar, cell: (r) => rp(r.total_keluar) },
    { id: "akhir", header: "Saldo akhir", align: "right", sortable: true, searchable: false, accessor: (r) => r.saldo_akhir, cell: (r) => <span className="font-medium">{rp(r.saldo_akhir)}</span> },
    { id: "fisik", header: "Saldo fisik", align: "right", searchable: false, accessor: (r) => r.saldo_fisik ?? -1, cell: (r) => (r.saldo_fisik === null ? "—" : rp(r.saldo_fisik)) },
    {
      id: "selisih", header: "Selisih", align: "right", searchable: false, accessor: (r) => r.selisih ?? 0,
      cell: (r) => <span className={selisihCls(r.selisih)}>{r.selisih === null ? "—" : r.selisih === 0 ? "Cocok" : rp(r.selisih)}</span>,
    },
    {
      id: "status", header: "Status", searchable: false, accessor: (r) => (r.terkunci ? "terkunci" : ""),
      cell: (r) => (r.terkunci ? <Badge variant="secondary">Terkunci (rekap)</Badge> : <span className="text-muted-foreground">—</span>),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ks-cabang">Station (cabang)</Label>
          <select id="ks-cabang" className={cn(selCls, "min-w-48")} value={cabang} onChange={(e) => setPilih(e.target.value)}>
            {cabangOpsi.length === 0 && <option value="">Tidak ada cabang</option>}
            {cabangOpsi.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {izin.stationCreate && cabang && (
          <Button onClick={() => setTambah(true)}><Plus /> Catat kas harian</Button>
        )}
      </div>

      {galat ? (
        <EmptyState title="Data tidak dapat dimuat" description={galat} />
      ) : !cabang ? (
        <EmptyState title="Belum ada station" description="Daftar station diambil dari cabang yang terdaftar di roster." />
      ) : loading && !data ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada catatan kas" description={izin.stationCreate ? "Mulai dengan tombol Catat kas harian. Catatan pertama station mengisi saldo awal dana idle." : "Station ini belum punya catatan."} />
      ) : (
        <DataTable columns={kolom} data={rows} getKey={(r) => r.id} pageSize={10} initialSort={{ id: "tanggal", dir: "desc" }}
          searchPlaceholder="Cari tanggal…" onRowClick={(r) => setDetailId(r.id)} />
      )}

      {tambah && (
        <TambahHarianDialog cabang={cabang} pertama={rows.length === 0} onClose={() => setTambah(false)}
          onSimpan={() => { setTambah(false); muatUlang(); }} />
      )}
      {detailId && (
        <DetailHarianDialog id={detailId} izin={izin} onClose={() => setDetailId(null)} onUbah={muatUlang} />
      )}
    </div>
  );
}

// ── Catat kas harian ────────────────────────────────────────────────────────

function TambahHarianDialog({ cabang, pertama, onClose, onSimpan }: { cabang: string; pertama: boolean; onClose: () => void; onSimpan: () => void }) {
  const [tanggal, setTanggal] = useState(hariIniWib());
  const [saldoAwal, setSaldoAwal] = useState("");
  const [saldoFisik, setSaldoFisik] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [trx, setTrx] = useState<BarisTrx[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ubah = (i: number, p: Partial<BarisTrx>) => setTrx((l) => l.map((b, j) => (j === i ? { ...b, ...p } : b)));

  async function simpan() {
    setErr(null);
    if (pertama && saldoAwal === "") return setErr("Saldo awal wajib diisi untuk catatan pertama station.");
    for (const [i, b] of trx.entries()) {
      if (!b.nominal || Number(b.nominal) <= 0) return setErr(`Transaksi #${i + 1}: nominal harus lebih dari 0.`);
      if (!b.uraian.trim()) return setErr(`Transaksi #${i + 1}: uraian wajib diisi.`);
    }
    setBusy(true);
    try {
      await kasApi("harian", {
        method: "POST",
        body: {
          cabang, tanggal,
          ...(pertama ? { saldo_awal: Number(saldoAwal) } : {}),
          ...(saldoFisik !== "" ? { saldo_fisik: Number(saldoFisik) } : {}),
          keterangan: keterangan.trim() || undefined,
          transaksi: trx.map((b) => ({ jenis: b.jenis, nominal: Number(b.nominal), uraian: b.uraian.trim(), bukti_ref: b.bukti_ref.trim() || undefined })),
        },
      });
      onSimpan();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Catat kas harian — {cabang}</DialogTitle>
          <DialogDescription>
            {pertama
              ? "Catatan pertama station: isi saldo awal (dana idle). Hari berikutnya saldo awal otomatis = saldo akhir hari sebelumnya."
              : "Saldo awal otomatis = saldo akhir catatan sebelumnya. Saldo akhir dihitung sistem: saldo awal + masuk − keluar."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p role="alert" className="text-destructive text-sm">{err}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="kh-tgl">Tanggal *</Label>
              <Input id="kh-tgl" type="date" max={hariIniWib()} value={tanggal} onChange={(e) => setTanggal(e.target.value)} /></div>
            {pertama && (
              <div className="space-y-1"><Label htmlFor="kh-awal">Saldo awal *</Label>
                <CurrencyInput id="kh-awal" value={saldoAwal} onChange={setSaldoAwal} /></div>
            )}
            <div className="space-y-1"><Label htmlFor="kh-fisik">Saldo fisik (opsional, untuk cek selisih)</Label>
              <CurrencyInput id="kh-fisik" value={saldoFisik} onChange={setSaldoFisik} /></div>
            <div className="space-y-1"><Label htmlFor="kh-ket">Keterangan</Label>
              <Input id="kh-ket" maxLength={500} value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Transaksi</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setTrx((l) => [...l, trxKosong()])}><Plus /> Tambah baris</Button>
            </div>
            {trx.length === 0 && <p className="text-muted-foreground text-sm">Belum ada transaksi — boleh dikosongkan bila hari ini tidak ada mutasi kas.</p>}
            {trx.map((b, i) => (
              <div key={i} className="grid items-start gap-2 rounded-md border p-2 sm:grid-cols-[7rem_10rem_1fr_9rem_auto]">
                <select aria-label="Jenis" className={selCls} value={b.jenis} onChange={(e) => ubah(i, { jenis: e.target.value as JenisTransaksi })}>
                  <option value="keluar">Keluar</option><option value="masuk">Masuk</option>
                </select>
                <CurrencyInput value={b.nominal} onChange={(v) => ubah(i, { nominal: v })} />
                <Input aria-label="Uraian" placeholder="Uraian *" maxLength={500} value={b.uraian} onChange={(e) => ubah(i, { uraian: e.target.value })} />
                <Input aria-label="Nomor bukti" placeholder="No. nota/bukti" maxLength={500} value={b.bukti_ref} onChange={(e) => ubah(i, { bukti_ref: e.target.value })} />
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Hapus baris" onClick={() => setTrx((l) => l.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={simpan} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail & ubah ───────────────────────────────────────────────────────────

function DetailHarianDialog({ id, izin, onClose, onUbah }: { id: string; izin: IzinKasStation; onClose: () => void; onUbah: () => void }) {
  const { data: h, galat, loading, muatUlang } = useKasData<HarianDetail>(`harian/${encodeURIComponent(id)}`);
  const { confirm, dialog } = useConfirm();
  const [baru, setBaru] = useState<BarisTrx>(trxKosong());
  const [fisik, setFisik] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function jalankan(fn: () => Promise<unknown>, selesai?: () => void) {
    setBusy(true); setErr(null);
    try { await fn(); muatUlang(); onUbah(); selesai?.(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const ubahBolehTulis = !!h && h.bisa_diubah;
  const alasanKunci = !h ? "" : h.terkunci
    ? "Sudah masuk rekap yang diajukan/disetujui — terkunci."
    : !h.bisa_diubah ? "Hanya catatan terakhir station yang bisa diubah (saldo awal hari berikutnya bergantung padanya)." : "";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
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
                  <dd className={cn("tabular-nums", selisihCls(h.selisih))}>{h.selisih === null ? "—" : h.selisih === 0 ? "Cocok" : rp(h.selisih)}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Keterangan</dt><dd>{h.keterangan ?? "—"}</dd></div>
              </dl>

              {alasanKunci && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{alasanKunci}</p>}

              <div className="space-y-2">
                <Label>Transaksi ({h.transaksi.length})</Label>
                {h.transaksi.length === 0 ? <p className="text-muted-foreground text-sm">Tidak ada transaksi.</p> : (
                  <ul className="divide-y rounded-md border text-sm">
                    {h.transaksi.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                        <Badge variant={t.jenis === "masuk" ? "outline" : "secondary"}>{t.jenis === "masuk" ? "Masuk" : "Keluar"}</Badge>
                        <span className="min-w-0 flex-1 truncate">{t.uraian}{t.bukti_ref ? <span className="text-muted-foreground"> · {t.bukti_ref}</span> : null}</span>
                        <span className="tabular-nums">{rp(t.nominal)}</span>
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

              {ubahBolehTulis && izin.stationCreate && (
                <div className="space-y-2 rounded-md border p-3">
                  <Label>Tambah transaksi</Label>
                  <div className="grid items-start gap-2 sm:grid-cols-[7rem_10rem_1fr_9rem]">
                    <select aria-label="Jenis" className={selCls} value={baru.jenis} onChange={(e) => setBaru({ ...baru, jenis: e.target.value as JenisTransaksi })}>
                      <option value="keluar">Keluar</option><option value="masuk">Masuk</option>
                    </select>
                    <CurrencyInput value={baru.nominal} onChange={(v) => setBaru({ ...baru, nominal: v })} />
                    <Input aria-label="Uraian" placeholder="Uraian *" maxLength={500} value={baru.uraian} onChange={(e) => setBaru({ ...baru, uraian: e.target.value })} />
                    <Input aria-label="Nomor bukti" placeholder="No. nota/bukti" maxLength={500} value={baru.bukti_ref} onChange={(e) => setBaru({ ...baru, bukti_ref: e.target.value })} />
                  </div>
                  <Button size="sm" disabled={busy || !baru.nominal || Number(baru.nominal) <= 0 || !baru.uraian.trim()}
                    onClick={() => void jalankan(
                      () => kasApi(`harian/${id}/transaksi`, { method: "POST", body: { jenis: baru.jenis, nominal: Number(baru.nominal), uraian: baru.uraian.trim(), bukti_ref: baru.bukti_ref.trim() || undefined } }),
                      () => setBaru(trxKosong()),
                    )}><Plus /> Tambah</Button>
                </div>
              )}

              {ubahBolehTulis && izin.stationEdit && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="space-y-1"><Label htmlFor="kd-fisik">Saldo fisik (cek selisih)</Label>
                    <CurrencyInput id="kd-fisik" value={fisik ?? (h.saldo_fisik === null ? "" : String(h.saldo_fisik))} onChange={setFisik} /></div>
                  <Button size="sm" variant="outline" disabled={busy || fisik === null}
                    onClick={() => void jalankan(() => kasApi(`harian/${id}`, { method: "PATCH", body: { saldo_fisik: fisik === "" ? null : Number(fisik) } }), () => setFisik(null))}>
                    Simpan saldo fisik</Button>
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
