"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AddAssetTagButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ kode: "", nama: "", jenis_kepemilikan: "aset", kategori: "", lokasi_cabang: "", letak: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset-tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kode: f.kode.trim(),
          nama: f.nama.trim(),
          jenis_kepemilikan: f.jenis_kepemilikan,
          kategori: f.kategori.trim() || undefined,
          lokasi_cabang: f.lokasi_cabang.trim() || undefined,
          letak: f.letak.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ kode: "", nama: "", jenis_kepemilikan: "aset", kategori: "", lokasi_cabang: "", letak: "" });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Tambah Aset
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah aset</DialogTitle>
          <DialogDescription>Kode harus unik, mis. WRG-KMG-FRN-001.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="na-kode">Kode</Label>
              <Input id="na-kode" value={f.kode} onChange={(e) => setF((p) => ({ ...p, kode: e.target.value }))} placeholder="WRG-KMG-FRN-001" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-nama">Nama</Label>
              <Input id="na-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} placeholder="Rak Besi Susun" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-jenis">Jenis Kepemilikan</Label>
              <select id="na-jenis" className={selectCls} value={f.jenis_kepemilikan} onChange={(e) => setF((p) => ({ ...p, jenis_kepemilikan: e.target.value }))}>
                <option value="aset">Aset</option>
                <option value="inventaris">Inventaris</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-kategori">Kategori</Label>
              <Input id="na-kategori" value={f.kategori} onChange={(e) => setF((p) => ({ ...p, kategori: e.target.value }))} placeholder="Furniture / Elektronik / dst (opsional)" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-lokasi">Lokasi Cabang</Label>
              <Input id="na-lokasi" value={f.lokasi_cabang} onChange={(e) => setF((p) => ({ ...p, lokasi_cabang: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-letak">Letak</Label>
              <Input id="na-letak" value={f.letak} onChange={(e) => setF((p) => ({ ...p, letak: e.target.value }))} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
