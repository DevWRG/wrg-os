"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { ambil, bulan, labelAlat, labelSn, rp, tgl, type AlatKsoCari, type AlatKsoRingkas, type DetailAset } from "./types";

type AlatPilihan = Pick<AlatKsoRingkas, "id" | "sn_key" | "customer_raw" | "nama_alat" | "type_alat">;

const SUMBER_LABEL: Record<string, string> = { otomatis: "otomatis", konfirmasi: "dikonfirmasi", manual: "manual" };

// Hari ini (WIB) dalam format <input type="date"> — batas atas tanggal perolehan.
const hariIniWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

// Detail satu aset: angka Accurate (read-only), jadwal depresiasi hasil hitung,
// dan lapisan override Finance (tanggal perolehan asli, tautan alat KSO,
// catatan) — satu-satunya bagian yang bisa diubah di WRG-OS.
// Pemanggil memberi `key={id}`, jadi state lama tak pernah bocor ke aset lain.
// Berhasil simpan → dialog ditutup dan pemanggil diberi tahu (onSaved); gagal →
// dialog tetap terbuka dengan pesan di dekat tombol, supaya isian tak hilang.
export function AsetDialog({ id, canEdit, onClose, onSaved }: {
  id: number | null; canEdit: boolean; onClose: () => void; onSaved: (nomor: string) => void;
}) {
  const [d, setD] = useState<DetailAset | null>(null);
  const [f, setF] = useState({ tgl_perolehan_asli: "", catatan: "" });
  const [alat, setAlat] = useState<AlatPilihan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (id == null) return;
    let batal = false;
    ambil<DetailAset>(`/api/aset-tetap/${id}/jadwal`)
      .then((r) => {
        if (batal) return;
        setD(r);
        if (r.ok) {
          setF({ tgl_perolehan_asli: r.aset.tgl_perolehan_asli ?? "", catatan: r.aset.catatan_finance ?? "" });
          setAlat(r.alat);
        }
      })
      .catch((e) => { if (!batal) setD({ ok: false, error: (e as Error).message }); });
    return () => { batal = true; };
  }, [id]);

  const a = d?.ok ? d.aset : null;

  const simpan = async () => {
    if (id == null || !a) return;
    if (f.tgl_perolehan_asli && f.tgl_perolehan_asli > hariIniWib()) {
      setErr("Tanggal perolehan tidak boleh di masa depan.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      await ambil(`/api/aset-tetap/${id}/override`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tgl_perolehan_asli: f.tgl_perolehan_asli || null,
          kso_asset_id: alat?.id ?? null,
          catatan: f.catatan,
        }),
      });
      onSaved(a.number);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

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
                : d.jadwal.length === 0
                  ? <p className="text-muted-foreground text-sm">Tidak ada jadwal: nilai yang bisa disusutkan (perolehan − residu) sudah nol.</p>
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
                  <Input id="tgl-asli" type="date" value={f.tgl_perolehan_asli} max={hariIniWib()} disabled={!canEdit}
                    onChange={(e) => setF({ ...f, tgl_perolehan_asli: e.target.value })} />
                  <p className="text-muted-foreground text-xs">Isi bila tanggal di Accurate adalah tanggal saldo awal, bukan tanggal beli.</p>
                </div>
                <PilihAlat
                  nomor={a.number}
                  alat={alat}
                  sumber={alat && d.alat && alat.id === d.alat.id ? d.alat.tautan_sumber : null}
                  canEdit={canEdit}
                  onChange={setAlat}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="catatan">Catatan</Label>
                <Textarea id="catatan" rows={2} value={f.catatan} disabled={!canEdit}
                  onChange={(e) => setF({ ...f, catatan: e.target.value })} />
              </div>
            </section>
          </DialogBody>
        )}
        {err && (
          <p role="alert" className="border-destructive/40 bg-destructive/10 text-destructive mx-4 rounded-md border px-3 py-2 text-sm">
            Gagal menyimpan: {err}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          {canEdit && a && <Button onClick={simpan} disabled={busy}>{busy ? "Menyimpan…" : "Simpan catatan"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tautan alat KSO: tampil sebagai nama alat · SN · faskes (bukan id angka), diganti
// lewat pencarian SN / nama alat / faskes. Alat yang sudah dipegang aset lain
// tampil tapi tak bisa dipilih — server juga menolaknya.
function PilihAlat({ nomor, alat, sumber, canEdit, onChange }: {
  nomor: string; alat: AlatPilihan | null; sumber: string | null; canEdit: boolean; onChange: (a: AlatPilihan | null) => void;
}) {
  const [cari, setCari] = useState(false);
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<AlatKsoCari[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!cari || q.trim().length < 2) return;
    let batal = false;
    const t = setTimeout(() => {
      ambil<{ rows: AlatKsoCari[] }>(`/api/aset-tetap/kso-alat?${new URLSearchParams({ q: q.trim() })}`)
        .then((r) => { if (!batal) { setHasil(r.rows); setErr(null); } })
        .catch((e) => { if (!batal) setErr((e as Error).message); });
    }, 300);
    return () => { batal = true; clearTimeout(t); };
  }, [cari, q]);

  const tutupCari = () => { setCari(false); setQ(""); setHasil(null); setErr(null); };

  return (
    <div className="space-y-1">
      <Label htmlFor="cari-alat">Alat KSO tertaut</Label>
      {!cari && (
        <div className="flex min-h-9 items-start justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
          {alat ? (
            <div className="min-w-0">
              <div className="truncate font-medium">
                {labelAlat(alat)}
                {sumber && <Badge variant="outline" className="ml-2 align-middle text-xs font-normal">{SUMBER_LABEL[sumber] ?? sumber}</Badge>}
              </div>
              <div className="text-muted-foreground truncate text-xs">{labelSn(alat.sn_key)} · {alat.customer_raw}</div>
            </div>
          ) : <span className="text-muted-foreground py-0.5">Belum tertaut</span>}
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setCari(true)}>{alat ? "Ganti" : "Cari alat"}</Button>
              {alat && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Lepas</Button>}
            </div>
          )}
        </div>
      )}
      {cari && (
        <div className="space-y-1 rounded-md border p-2">
          <div className="flex gap-2">
            <Input id="cari-alat" autoFocus placeholder="Ketik SN, nama alat, atau faskes…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="button" size="sm" variant="ghost" onClick={tutupCari}>Batal</Button>
          </div>
          {err && <p className="text-destructive text-xs">{err}</p>}
          {q.trim().length >= 2 && hasil && (
            <ul className="max-h-48 overflow-y-auto text-sm">
              {hasil.length === 0 && <li className="text-muted-foreground px-1 py-2 text-xs">Tidak ada alat yang cocok.</li>}
              {hasil.map((h) => {
                const dipegangLain = h.tertaut_ke != null && h.tertaut_ke !== nomor;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      disabled={dipegangLain}
                      onClick={() => { onChange(h); tutupCari(); }}
                      className="hover:bg-accent w-full rounded px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="truncate font-medium">{labelAlat(h)}</div>
                      <div className="text-muted-foreground truncate text-xs">
                        {labelSn(h.sn_key)} · {h.customer_raw}
                        {dipegangLain && <> · sudah tertaut ke {h.tertaut_ke}</>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {canEdit && <p className="text-muted-foreground text-xs">Perubahan tautan baru berlaku setelah Simpan.</p>}
    </div>
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
