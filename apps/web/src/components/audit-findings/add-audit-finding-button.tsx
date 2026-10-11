"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function AddAuditFindingButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [unitTerdampak, setUnitTerdampak] = useState("");
  const [controlLinkage, setControlLinkage] = useState("");
  const [dueDate, setDueDate] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/audit-findings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          source: source.trim() || undefined,
          unit_terdampak: unitTerdampak.trim() || undefined,
          control_linkage: controlLinkage.trim() || undefined,
          due_date: dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setTitle(""); setDescription(""); setSource(""); setUnitTerdampak(""); setControlLinkage(""); setDueDate("");
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
        <Plus /> Catat Temuan
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Catat temuan audit</DialogTitle>
          <DialogDescription>Kode otomatis (TEMUAN-YYYY-NNNNN). Field bisa dilengkapi belakangan sebelum diajukan penutupan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="af-title">Judul</Label>
              <Input id="af-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Selisih stok gudang cabang X" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="af-desc">Deskripsi</Label>
              <Textarea id="af-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="opsional, detail temuan" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="af-source">Sumber</Label>
              <Input id="af-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="mis. audit internal, whistleblower" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="af-unit">Unit Terdampak</Label>
              <Input id="af-unit" value={unitTerdampak} onChange={(e) => setUnitTerdampak(e.target.value)} placeholder="mis. Gudang Cabang X" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="af-linkage">Control Linkage (F-number)</Label>
              <Input id="af-linkage" value={controlLinkage} onChange={(e) => setControlLinkage(e.target.value)} placeholder="mis. F138" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="af-due">Due Date</Label>
              <Input id="af-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !title.trim()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
