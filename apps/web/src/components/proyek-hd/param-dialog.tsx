"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { kirim, type Param } from "./types";

const KELOMPOK = [
  { judul: "Tracker", cocok: (k: string) => !/^(rs|margin)_/.test(k) },
  { judul: "Simulator — Proyeksi RS", cocok: (k: string) => k.startsWith("rs_") },
  { judul: "Simulator — Margin WRG", cocok: (k: string) => k.startsWith("margin_") },
];

// Nilai default tracker & simulator (tabel hd_param). Harga/tarif sengaja tidak ada di kode
// (repo publik) — diisi di sini. Kunci margin_* hanya terkirim ke pemegang Margin WRG.
export function ParamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Param[] | null>(null);
  const [boleh, setBoleh] = useState(false);
  const [ubah, setUbah] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    kirim<{ items: Param[]; boleh_ubah: boolean }>("/api/proyek-hd/param")
      .then((d) => { setItems(d.items); setBoleh(d.boleh_ubah); })
      .catch((e) => setErr((e as Error).message));
  }, []);

  const nilaiTampil = (p: Param) => (p.kunci in ubah ? ubah[p.kunci] : p.nilai == null ? "" : String(p.nilai));

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      const nilai = Object.fromEntries(Object.entries(ubah).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));
      const d = await kirim<{ items: Param[] }>("/api/proyek-hd/param", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nilai }),
      });
      setItems((prev) => {
        const baru = new Map(d.items.map((p) => [p.kunci, p]));
        return (prev ?? []).map((p) => baru.get(p.kunci) ?? p);
      });
      setUbah({});
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
          <DialogTitle>Parameter Proyek HD</DialogTitle>
          <DialogDescription>Nilai awal simulator & rumus tracker. Kosong = belum diisi (simulator memakai 0 dan memberi peringatan).</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {!items && !err && <p className="text-muted-foreground text-sm">Memuat…</p>}
          {items && KELOMPOK.map((g) => {
            const xs = items.filter((p) => g.cocok(p.kunci));
            if (!xs.length) return null;
            return (
              <div key={g.judul} className="space-y-2">
                <h3 className="text-sm font-semibold">{g.judul}</h3>
                {xs.map((p) => (
                  <label key={p.kunci} className="grid grid-cols-[1fr_9rem] items-center gap-3 text-sm">
                    <span>{p.keterangan.replace(/^(Proyeksi RS|Margin) — /, "")}</span>
                    <Input type="number" min={0} step="any" className="bg-card text-right" disabled={!boleh}
                      value={nilaiTampil(p)} onChange={(e) => setUbah((u) => ({ ...u, [p.kunci]: e.target.value }))} />
                  </label>
                ))}
              </div>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Tutup</Button>
          {boleh && <Button type="button" disabled={busy || !Object.keys(ubah).length} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan parameter"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
