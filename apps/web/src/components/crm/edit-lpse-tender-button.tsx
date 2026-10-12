"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { EmployeeOption } from "./add-lpse-tender-button";

const NONE = "__none__"; // sentinel Select — Base UI Select tak suka value kosong

interface EditableTender {
  id: string;
  judul: string;
  instansi: string;
  tender_no: string | null;
  platform: string;
  pic_employee_id: string | null;
  notes: string | null;
}

// Sebelumnya TIDAK ADA jalur edit sama sekali — tender yang dibuat tanpa PIC
// (waktu itu masih opsional, sekarang wajib) tak pernah bisa ditambal.
// Ditemukan user 2026-09-07.
export function EditLpseTenderButton({ tender, employees }: { tender: EditableTender; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judul, setJudul] = useState(tender.judul);
  const [instansi, setInstansi] = useState(tender.instansi);
  const [tenderNo, setTenderNo] = useState(tender.tender_no ?? "");
  const [platform, setPlatform] = useState(tender.platform);
  const [picEmployeeId, setPicEmployeeId] = useState(tender.pic_employee_id ?? "");
  const [notes, setNotes] = useState(tender.notes ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lpse-tender/${tender.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          judul: judul.trim(),
          instansi: instansi.trim(),
          tender_no: tenderNo.trim() || null,
          platform,
          pic_employee_id: picEmployeeId,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal menyimpan");
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
      <Button size="icon-sm" variant="ghost" onClick={() => setOpen(true)} title="Edit tender">
        <Pencil />
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tender LPSE/E-Catalog</DialogTitle>
          <DialogDescription>{tender.judul}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`elt-judul-${tender.id}`}>Judul / Nama Tender</Label>
              <Input id={`elt-judul-${tender.id}`} required value={judul} onChange={(e) => setJudul(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`elt-instansi-${tender.id}`}>Instansi</Label>
              <Input id={`elt-instansi-${tender.id}`} required value={instansi} onChange={(e) => setInstansi(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`elt-no-${tender.id}`}>No. Tender (opsional)</Label>
              <Input id={`elt-no-${tender.id}`} value={tenderNo} onChange={(e) => setTenderNo(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v ?? "lpse")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => (v === "e_catalog" ? "E-Catalog" : "LPSE")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lpse">LPSE</SelectItem>
                  <SelectItem value="e_catalog">E-Catalog</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>PIC *</Label>
              <Select value={picEmployeeId || NONE} onValueChange={(v) => setPicEmployeeId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih PIC">{(v: string) => (v === NONE ? "Pilih PIC" : employees.find((e) => e.id === v)?.nama ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>— pilih salah satu —</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nama}{e.dept_label ? ` (${e.dept_label})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`elt-notes-${tender.id}`}>Catatan</Label>
              <Textarea id={`elt-notes-${tender.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !judul.trim() || !instansi.trim() || !picEmployeeId}>
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
