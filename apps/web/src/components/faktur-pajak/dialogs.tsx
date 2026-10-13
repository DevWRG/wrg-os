"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  LANGKAH_MAJU, LANGKAH_MUNDUR, STATUS_CLS, STATUS_LABEL, jsonInit, kirim, rupiah, tglId,
  type FpDetail, type FpStatus, type Kandidat,
} from "./types";

// ── Ajukan FP dari invoice ───────────────────────────────────────────────────

export function AjukanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kandidat, setKandidat] = useState<Kandidat[]>([]);
  const [pilih, setPilih] = useState<Kandidat | null>(null);
  const [npwp, setNpwp] = useState("");
  const [catatan, setCatatan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let batal = false;
    const t = setTimeout(() => {
      kirim<{ items: Kandidat[] }>(`/api/faktur-pajak/candidates?q=${encodeURIComponent(q)}`)
        .then((d) => { if (!batal) setKandidat(d.items); })
        .catch((e) => { if (!batal) setErr((e as Error).message); });
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [open, q]);

  async function simpan() {
    if (!pilih) return;
    setBusy(true);
    setErr(null);
    try {
      await kirim("/api/faktur-pajak", jsonInit("POST", { invoice_id: pilih.invoice_id, customer_npwp: npwp || null, catatan: catatan || null }));
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajukan faktur pajak</DialogTitle>
          <DialogDescription>Invoice ber-PPN (4 bulan terakhir) yang belum punya faktur pajak aktif. Terlama di atas.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <Input placeholder="Cari no. invoice / customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto rounded-md border">
            {kandidat.length === 0 && <p className="text-muted-foreground p-3 text-sm">Tidak ada invoice yang cocok.</p>}
            {kandidat.map((k) => (
              <button key={k.invoice_id} type="button" onClick={() => { setPilih(k); setNpwp(k.customer_npwp ?? ""); }}
                className={cn("hover:bg-muted flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-0", pilih?.invoice_id === k.invoice_id && "bg-muted")}>
                <span><span className="font-medium">{k.invoice_number}</span> · {k.customer_name ?? "—"}
                  <span className="text-muted-foreground block text-xs">{tglId(k.tanggal)} · batas terbit {tglId(k.batas_terbit)}{k.terlambat ? " · TERLAMBAT" : ""}</span></span>
                <span className="tabular-nums">{rupiah(k.ppn)}</span>
              </button>
            ))}
          </div>
          {pilih && (
            <>
              <div className="space-y-1"><Label htmlFor="fp-npwp">NPWP customer</Label>
                <Input id="fp-npwp" value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="Belum ada di Accurate — isi bila diketahui" /></div>
              <div className="space-y-1"><Label htmlFor="fp-cat">Catatan</Label>
                <Textarea id="fp-cat" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button disabled={busy || !pilih} onClick={() => void simpan()}>{busy ? "Menyimpan…" : "Ajukan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail & geser status ────────────────────────────────────────────────────

export function DetailDialog({ id, onClose, bolehUbah }: { id: number; onClose: () => void; bolehUbah: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<FpDetail | null>(null);
  const [nomor, setNomor] = useState("");
  const [bukti, setBukti] = useState("");
  const [alasan, setAlasan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let batal = false;
    kirim<FpDetail>(`/api/faktur-pajak/${id}`)
      .then((r) => { if (!batal) { setD(r); setNomor(r.nomor_fp ?? ""); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  async function pindah(ke: FpStatus) {
    setBusy(true);
    setErr(null);
    try {
      await kirim(`/api/faktur-pajak/${id}/status`, jsonInit("POST", { ke, nomor_fp: nomor || null, bukti_url: bukti || null, catatan: alasan || null }));
      setD(await kirim<FpDetail>(`/api/faktur-pajak/${id}`));
      setAlasan("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const maju = d ? LANGKAH_MAJU[d.status] : undefined;
  const mundur = d ? LANGKAH_MUNDUR[d.status] : undefined;
  const final = d?.status === "selesai" || d?.status === "dibatalkan";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `Faktur pajak — ${d.invoice_number}` : "Faktur pajak"}</DialogTitle>
          {d && <DialogDescription>{d.customer_name ?? "—"} · NPWP {d.customer_npwp ?? "belum ada"} · masa pajak {d.masa_pajak}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {d && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div><div className="text-muted-foreground text-xs">DPP</div><div className="tabular-nums">{rupiah(d.dpp)}</div></div>
                <div><div className="text-muted-foreground text-xs">PPN</div><div className="tabular-nums">{rupiah(d.ppn)}</div></div>
                <div><div className="text-muted-foreground text-xs">Batas terbit</div><div className={cn(d.terlambat && "font-medium text-rose-700 dark:text-rose-400")}>{tglId(d.batas_terbit)}{d.terlambat ? " · terlambat" : ""}</div></div>
                <div><div className="text-muted-foreground text-xs">Status</div><span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[d.status])}>{STATUS_LABEL[d.status]}</span></div>
              </div>
              {d.nomor_fp && <p className="text-sm">Nomor FP: <span className="font-medium tabular-nums">{d.nomor_fp}</span></p>}
              {d.bukti_url && <p className="text-sm">Bukti: <a className="text-primary underline" href={d.bukti_url} target="_blank" rel="noopener noreferrer">buka tautan</a></p>}

              {bolehUbah && !final && (
                <div className="space-y-2 rounded-md border p-3">
                  {d.status === "diinput_coretax" && (
                    <div className="space-y-1"><Label htmlFor="fp-nomor">Nomor FP (dari CoreTax)</Label>
                      <Input id="fp-nomor" value={nomor} onChange={(e) => setNomor(e.target.value)} placeholder="mis. 0100002600000001" /></div>
                  )}
                  {d.status === "disetujui" && (
                    <div className="space-y-1"><Label htmlFor="fp-bukti">Tautan bukti (https)</Label>
                      <Input id="fp-bukti" value={bukti} onChange={(e) => setBukti(e.target.value)} placeholder="https://drive.google.com/…" /></div>
                  )}
                  <div className="space-y-1"><Label htmlFor="fp-alasan">Catatan / alasan (wajib untuk kembali & batal)</Label>
                    <Textarea id="fp-alasan" rows={2} value={alasan} onChange={(e) => setAlasan(e.target.value)} /></div>
                  <div className="flex flex-wrap gap-2">
                    {maju && <Button size="sm" disabled={busy} onClick={() => void pindah(maju.ke)}>{maju.label}</Button>}
                    {mundur && <Button size="sm" variant="outline" disabled={busy || !alasan.trim()} onClick={() => void pindah(mundur)}>Kembalikan ke {STATUS_LABEL[mundur]}</Button>}
                    <Button size="sm" variant="ghost" disabled={busy || !alasan.trim()} onClick={() => void pindah("dibatalkan")}>Batalkan</Button>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-sm font-medium">Riwayat</div>
                <ul className="space-y-1 text-sm">
                  {d.events.map((e) => (
                    <li key={e.id} className="text-muted-foreground">
                      {new Date(e.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — <span className="text-foreground">{STATUS_LABEL[e.ke]}</span>
                      {e.oleh ? ` oleh ${e.oleh}` : ""}{e.catatan ? ` — ${e.catatan}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Tutup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
