"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Category {
  id: string;
  code: string;
  nama: string;
  icon: string | null;
  default_sla_hours: number;
  default_priority: string;
  active: boolean;
}

export function GaTicketCategoryRowActions({ category }: { category: Category }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: category.nama,
    icon: category.icon ?? "",
    default_sla_hours: String(category.default_sla_hours),
    default_priority: category.default_priority,
  });
  const { confirm, dialog } = useConfirm();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-ticket-categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          icon: f.icon.trim() || null,
          default_sla_hours: Number(f.default_sla_hours) || undefined,
          default_priority: f.default_priority,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  function deactivate() {
    confirm(
      { title: "Nonaktifkan kategori?", description: `Kategori "${category.nama}" tak akan muncul lagi sbg pilihan tiket baru.`, destructive: true, confirmLabel: "Nonaktifkan" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/ga-ticket-categories/${category.id}/deactivate`, { method: "PATCH" });
          if (!res.ok) throw new Error("gagal nonaktifkan");
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)} title="Edit">
          <Pencil />
        </Button>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit — {category.code}</DialogTitle>
            <DialogDescription>Update nama, ikon, SLA default, prioritas default.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`gtce-nama-${category.id}`}>Nama</Label>
                <Input id={`gtce-nama-${category.id}`} value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`gtce-icon-${category.id}`}>Ikon (emoji)</Label>
                <Input id={`gtce-icon-${category.id}`} value={f.icon} onChange={(e) => setF((p) => ({ ...p, icon: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`gtce-sla-${category.id}`}>SLA default (jam)</Label>
                <Input id={`gtce-sla-${category.id}`} type="number" min={1} value={f.default_sla_hours} onChange={(e) => setF((p) => ({ ...p, default_sla_hours: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`gtce-priority-${category.id}`}>Prioritas default</Label>
                <select id={`gtce-priority-${category.id}`} className={selectCls} value={f.default_priority} onChange={(e) => setF((p) => ({ ...p, default_priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
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
      {category.active && (
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={deactivate} className="text-danger hover:text-danger" title="Nonaktifkan">
          <Ban />
        </Button>
      )}
    </div>
  );
}
