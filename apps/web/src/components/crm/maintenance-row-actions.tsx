"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

interface MaintenanceScheduleRow {
  id: string;
  alat_name: string;
}

export function MaintenanceRowActions({ row }: { row: MaintenanceScheduleRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/${row.id}/done`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catatan: catatan.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setCatatan("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCatatan(""); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <CheckCircle2 /> Tandai Selesai
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tandai siklus PM/kalibrasi selesai</DialogTitle>
          <DialogDescription>{row.alat_name} — due_date siklus berikutnya otomatis dihitung ulang.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`ms-catatan-${row.id}`}>Catatan (opsional)</Label>
              <Textarea id={`ms-catatan-${row.id}`} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="hasil servis/kalibrasi…" />
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
