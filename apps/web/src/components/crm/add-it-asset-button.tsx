"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

export function AddItAssetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ asset_code: "", nama: "", lokasi: "", pic_default: "", is_critical: false });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_code: f.asset_code.trim(),
          nama: f.nama.trim(),
          lokasi: f.lokasi.trim() || undefined,
          pic_default: f.pic_default.trim() || undefined,
          is_critical: f.is_critical,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ asset_code: "", nama: "", lokasi: "", pic_default: "", is_critical: false });
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
          <DialogTitle>Tambah aset IT</DialogTitle>
          <DialogDescription>Kode aset harus unik (mis. PC-001).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="na-kode">Kode aset</Label>
              <Input id="na-kode" value={f.asset_code} onChange={(e) => setF((p) => ({ ...p, asset_code: e.target.value }))} placeholder="PC-001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-nama">Nama</Label>
              <Input id="na-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} placeholder="PC Fakturis 1" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-lokasi">Lokasi</Label>
              <Input id="na-lokasi" value={f.lokasi} onChange={(e) => setF((p) => ({ ...p, lokasi: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="na-pic">PIC Default</Label>
              <Input id="na-pic" value={f.pic_default} onChange={(e) => setF((p) => ({ ...p, pic_default: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.is_critical} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, is_critical: v }))} />
              <Label>Kritis (SLA tiket 2 jam)</Label>
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
