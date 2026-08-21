"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AddGaTicketCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ code: "", nama: "", icon: "", default_sla_hours: "24", default_priority: "medium" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ga-ticket-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: f.code.trim(),
          nama: f.nama.trim(),
          icon: f.icon.trim() || undefined,
          default_sla_hours: Number(f.default_sla_hours) || 24,
          default_priority: f.default_priority,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setF({ code: "", nama: "", icon: "", default_sla_hours: "24", default_priority: "medium" });
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
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus /> Tambah Kategori
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah kategori tiket</DialogTitle>
          <DialogDescription>Kode harus unik (mis. AC, LISTRIK, WIFI).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gtc-code">Kode</Label>
              <Input id="gtc-code" value={f.code} onChange={(e) => setF((p) => ({ ...p, code: e.target.value }))} placeholder="AC" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gtc-nama">Nama</Label>
              <Input id="gtc-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} placeholder="AC Rusak" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gtc-icon">Ikon (emoji)</Label>
              <Input id="gtc-icon" value={f.icon} onChange={(e) => setF((p) => ({ ...p, icon: e.target.value }))} placeholder="opsional, mis. ❄️" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gtc-sla">SLA default (jam)</Label>
              <Input id="gtc-sla" type="number" min={1} value={f.default_sla_hours} onChange={(e) => setF((p) => ({ ...p, default_sla_hours: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gtc-priority">Prioritas default</Label>
              <select id="gtc-priority" className={selectCls} value={f.default_priority} onChange={(e) => setF((p) => ({ ...p, default_priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !f.code.trim() || !f.nama.trim()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
