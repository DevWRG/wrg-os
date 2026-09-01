"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface AssetOption {
  id: string;
  asset_code: string;
  nama: string;
  is_critical: boolean;
}

export function AddItTicketButton({ assets }: { assets: AssetOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ asset_id: assets[0]?.id ?? "", masalah: "", reported_by: "", assigned_to: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_id: f.asset_id,
          masalah: f.masalah.trim(),
          reported_by: f.reported_by.trim() || undefined,
          assigned_to: f.assigned_to.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ asset_id: assets[0]?.id ?? "", masalah: "", reported_by: "", assigned_to: "" });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Buat Tiket
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Buat tiket masalah</DialogTitle>
          <DialogDescription>SLA otomatis: 2 jam untuk aset kritis, 24 jam untuk aset normal (hari kerja).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nt-asset">Aset</Label>
              <select
                id="nt-asset"
                className={selectCls}
                value={f.asset_id}
                onChange={(e) => setF((p) => ({ ...p, asset_id: e.target.value }))}
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.nama}
                    {a.is_critical ? " (KRITIS)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-masalah">Masalah</Label>
              <Textarea id="nt-masalah" value={f.masalah} onChange={(e) => setF((p) => ({ ...p, masalah: e.target.value }))} placeholder="mis. tidak bisa nyala, mati mendadak, dst" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-lapor">Pelapor</Label>
              <Input id="nt-lapor" value={f.reported_by} onChange={(e) => setF((p) => ({ ...p, reported_by: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-pic">PIC (opsional)</Label>
              <Input id="nt-pic" value={f.assigned_to} onChange={(e) => setF((p) => ({ ...p, assigned_to: e.target.value }))} placeholder="opsional" />
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
