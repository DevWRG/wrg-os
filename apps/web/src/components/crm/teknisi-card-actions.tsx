"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface TeknisiRow {
  id: string;
  nama: string;
  max_concurrent_jobs: number;
}

// Sejak migrasi 246 roster teknisi = master_user role Teknisi: nama, No. WA &
// status aktif diubah di menu Users, wilayah di Jadwal Teknisi. Di sini tinggal
// kapasitas job bersamaan.
export function TeknisiCardActions({ teknisi }: { teknisi: TeknisiRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxJobs, setMaxJobs] = useState(String(teknisi.max_concurrent_jobs));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Validasi sendiri (form noValidate): pesan bawaan browser berbahasa Inggris.
    const n = Number(maxJobs);
    if (maxJobs.trim() === "" || !Number.isInteger(n) || n < 1 || n > 50) {
      setError("Kapasitas harus bilangan bulat 1–50.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teknisi-capacity/${encodeURIComponent(teknisi.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ max_concurrent_jobs: n }),
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

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)} title="Ubah kapasitas">
        <Pencil />
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kapasitas teknisi</DialogTitle>
          <DialogDescription>{teknisi.nama}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`tk-edit-max-${teknisi.id}`}>Kapasitas job bersamaan</Label>
              <Input id={`tk-edit-max-${teknisi.id}`} type="number" min={1} max={50} value={maxJobs} onChange={(e) => setMaxJobs(e.target.value)} />
              <p className="text-muted-foreground text-xs">Nama, No. WA &amp; status aktif diubah di menu Users; wilayah di Jadwal Teknisi.</p>
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
