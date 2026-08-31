"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export interface EmployeeOption {
  id: string;
  nama: string;
  dept_label: string | null;
}

const NONE = "__none__"; // sentinel Select — Base UI Select tak suka value kosong

export function AddLpseTenderButton({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [judul, setJudul] = useState("");
  const [instansi, setInstansi] = useState("");
  const [tenderNo, setTenderNo] = useState("");
  const [platform, setPlatform] = useState("lpse");
  const [picEmployeeId, setPicEmployeeId] = useState("");
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lpse-tender", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          judul: judul.trim(),
          instansi: instansi.trim(),
          tender_no: tenderNo.trim() || undefined,
          platform,
          pic_employee_id: picEmployeeId || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal menyimpan");
      setJudul(""); setInstansi(""); setTenderNo(""); setPlatform("lpse"); setPicEmployeeId(""); setNotes("");
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
        <Plus /> Tambah Tender
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah tender LPSE/E-Catalog</DialogTitle>
          <DialogDescription>Dicatat sejak pesan masuk — status berikutnya diklik manual dari tabel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lt-judul">Judul / Nama Tender</Label>
              <Input id="lt-judul" required value={judul} onChange={(e) => setJudul(e.target.value)} placeholder="mis. Pengadaan Reagen Hematologi" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lt-instansi">Instansi</Label>
              <Input id="lt-instansi" required value={instansi} onChange={(e) => setInstansi(e.target.value)} placeholder="mis. RSUD Kota Malang" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lt-no">No. Tender (opsional, sering belum ada)</Label>
              <Input id="lt-no" value={tenderNo} onChange={(e) => setTenderNo(e.target.value)} placeholder="opsional" />
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
              <Label>PIC</Label>
              {/* Trigger dilebarkan (w-full) — SelectContent lebar ikut trigger
                  (--anchor-width), nama+dept karyawan bisa panjang & kepotong
                  kalau trigger sekecil placeholder "Pilih PIC". */}
              <Select value={picEmployeeId || NONE} onValueChange={(v) => setPicEmployeeId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih PIC">{(v: string) => (v === NONE ? "Pilih PIC" : employees.find((e) => e.id === v)?.nama ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— tidak pilih —</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nama}{e.dept_label ? ` (${e.dept_label})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lt-notes">Catatan</Label>
              <Textarea id="lt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !judul.trim() || !instansi.trim()}>
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
