"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ambil, bulan, rp, tgl, type DetailAset } from "./types";

// Detail satu aset: angka Accurate (read-only), jadwal depresiasi hasil hitung,
// dan lapisan override Finance (tanggal perolehan asli, tautan alat KSO,
// catatan) — satu-satunya bagian yang bisa diubah di WRG-OS.
// Pemanggil memberi `key={id}`, jadi state lama tak pernah bocor ke aset lain.
export function AsetDialog({ id, canEdit, onClose, onSaved }: {
  id: number | null; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState<DetailAset | null>(null);
  const [f, setF] = useState({ tgl_perolehan_asli: "", kso_asset_id: "", catatan: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) return;
    let batal = false;
    ambil<DetailAset>(`/api/aset-tetap/${id}/jadwal`)
      .then((r) => {
        if (batal) return;
        setD(r);
        if (r.ok) setF({
          tgl_perolehan_asli: r.aset.tgl_perolehan_asli ?? "",
          kso_asset_id: r.aset.kso_asset_id == null ? "" : String(r.aset.kso_asset_id),
          catatan: r.aset.catatan_finance ?? "",
        });
      })
      .catch((e) => { if (!batal) setD({ ok: false, error: (e as Error).message }); });
    return () => { batal = true; };
  }, [id]);

  const simpan = async () => {
    if (id == null) return;
    setBusy(true); setMsg(null);
    try {
      await ambil(`/api/aset-tetap/${id}/override`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tgl_perolehan_asli: f.tgl_perolehan_asli || null,
          kso_asset_id: f.kso_asset_id.trim() || null,
          catatan: f.catatan,
        }),
      });
      setMsg("Tersimpan.");
      onSaved();
    } catch (e) {
      setMsg(`Gagal: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const a = d?.ok ? d.aset : null;

  return (
    <Dialog open={id != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{a ? a.number : "Aset tetap"}</DialogTitle>
          <DialogDescription>{a?.description ?? (d && !d.ok ? d.error : "Memuat…")}</DialogDescription>
        </DialogHeader>
        {a && d?.ok && (
          <DialogBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Info k="Tipe" v={a.fa_type_name ?? "—"} />
              <Info k="Status" v={a.disposed ? "Dilepas (disposed)" : a.habis_susut ? "Aktif · habis disusutkan" : "Aktif"} />
              <Info k="Metode" v={a.depreciation_method === "STRAIGHTLINE" ? "Garis lurus" : (a.depreciation_method ?? "—")} />
              <Info k="Nilai perolehan" v={rp(a.current_asset_cost)} />
              <Info k="Akumulasi" v={rp(a.akumulasi)} />
              <Info k="Nilai buku" v={rp(a.book_value)} />
              <Info k="Residu" v={rp(a.residu)} />
              <Info k="Umur periode berjalan" v={a.current_estimated_life ? `${a.current_estimated_life} bulan` : "—"} />
              <Info k="Susut per bulan" v={a.habis_susut ? "habis" : rp(a.susut_per_bulan)} />
              <Info k="Tanggal di Accurate" v={tgl(a.trans_date)} />
              <Info k="Mulai susut (berjalan)" v={tgl(a.current_start_date)} />
              <Info k="Jurnal terakhir Accurate" v={tgl(a.last_journal_date)} />
            </dl>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Jadwal depresiasi</h3>
              {d.catatan
                ? <p className="text-muted-foreground text-sm">{d.catatan}</p>
                : (
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bulan</TableHead>
                          <TableHead className="text-right">Susut</TableHead>
                          <TableHead className="text-right">Akumulasi</TableHead>
                          <TableHead className="text-right">Nilai buku</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.jadwal.map((j) => (
                          <TableRow key={j.periode} className={cn(j.status === "berjalan" && "font-semibold", j.status === "proyeksi" && "text-muted-foreground")}>
                            <TableCell className="whitespace-nowrap">{bulan(j.periode)}{j.status === "berjalan" ? " · bulan ini" : ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{rp(j.susut)}</TableCell>
                            <TableCell className="text-right tabular-nums">{rp(j.akumulasi)}</TableCell>
                            <TableCell className="text-right tabular-nums">{rp(j.nilai_buku)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              <p className="text-muted-foreground text-xs">
                Dihitung WRG-OS dari periode berjalan Accurate (garis lurus). Jurnal resmi tetap di Accurate.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Catatan Finance</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="tgl-asli">Tanggal perolehan asli</Label>
                  <Input id="tgl-asli" type="date" value={f.tgl_perolehan_asli} disabled={!canEdit}
                    onChange={(e) => setF({ ...f, tgl_perolehan_asli: e.target.value })} />
                  <p className="text-muted-foreground text-xs">Isi bila tanggal di Accurate adalah tanggal saldo awal, bukan tanggal beli.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="kso-id">ID alat KSO (Daftar Alat)</Label>
                  <Input id="kso-id" inputMode="numeric" value={f.kso_asset_id} disabled={!canEdit}
                    onChange={(e) => setF({ ...f, kso_asset_id: e.target.value.replace(/\D/g, "") })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="catatan">Catatan</Label>
                <Textarea id="catatan" rows={2} value={f.catatan} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, catatan: e.target.value })} />
              </div>
              {msg && <p className="text-sm">{msg}</p>}
            </section>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          {canEdit && a && <Button onClick={simpan} disabled={busy}>Simpan catatan</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
