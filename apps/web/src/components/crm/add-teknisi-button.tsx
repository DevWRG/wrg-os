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

export function AddTeknisiButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [maxJobs, setMaxJobs] = useState("3");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/teknisi-capacity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: nama.trim(),
          wa_number: waNumber.trim() || undefined,
          max_concurrent_jobs: Number(maxJobs) || 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setNama(""); setWaNumber(""); setMaxJobs("3");
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
        <Plus /> Tambah Teknisi
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah teknisi</DialogTitle>
          <DialogDescription>Roster kapasitas kerja teknisi (Readiness Board).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tk-nama">Nama</Label>
              <Input id="tk-nama" required value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Enggar Robbi Novianto" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tk-wa">No. WA</Label>
              <Input id="tk-wa" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tk-max">Kapasitas job bersamaan</Label>
              <Input id="tk-max" type="number" min={1} value={maxJobs} onChange={(e) => setMaxJobs(e.target.value)} />
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
  );
}
