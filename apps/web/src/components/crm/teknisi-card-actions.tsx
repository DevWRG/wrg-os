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

interface TeknisiRow {
  id: string;
  nama: string;
  wa_number?: string | null;
  max_concurrent_jobs: number;
  aktif: boolean;
}

export function TeknisiCardActions({ teknisi }: { teknisi: TeknisiRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nama, setNama] = useState(teknisi.nama);
  const [waNumber, setWaNumber] = useState(teknisi.wa_number ?? "");
  const [maxJobs, setMaxJobs] = useState(String(teknisi.max_concurrent_jobs));
  const { confirm, dialog } = useConfirm();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teknisi-capacity/${teknisi.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: nama.trim(),
          wa_number: waNumber.trim() || null,
          max_concurrent_jobs: Number(maxJobs) || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
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
      { title: "Nonaktifkan teknisi?", description: `${teknisi.nama} tak akan muncul lagi sbg pilihan teknisi baru.`, destructive: true, confirmLabel: "Nonaktifkan" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/teknisi-capacity/${teknisi.id}/deactivate`, { method: "PATCH" });
          if (!res.ok) throw new Error("gagal nonaktifkan");
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex items-center gap-1">
      {dialog}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit teknisi</DialogTitle>
            <DialogDescription>{teknisi.nama}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor={`tk-edit-nama-${teknisi.id}`}>Nama</Label>
                <Input id={`tk-edit-nama-${teknisi.id}`} required value={nama} onChange={(e) => setNama(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`tk-edit-wa-${teknisi.id}`}>No. WA</Label>
                <Input id={`tk-edit-wa-${teknisi.id}`} value={waNumber} onChange={(e) => setWaNumber(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`tk-edit-max-${teknisi.id}`}>Kapasitas job bersamaan</Label>
                <Input id={`tk-edit-max-${teknisi.id}`} type="number" min={1} value={maxJobs} onChange={(e) => setMaxJobs(e.target.value)} />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button type="submit" disabled={busy || !nama.trim()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
              <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {teknisi.aktif && (
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={deactivate} className="text-danger hover:text-danger">
          <Ban />
        </Button>
      )}
    </div>
  );
}
