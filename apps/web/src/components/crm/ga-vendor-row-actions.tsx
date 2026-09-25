"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Vendor {
  id: string;
  nama: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  contract_end: string | null;
  status: string;
}

// Gak ada hard delete (endpoint-nya emang gak ada — status active/inactive
// dipakai sbg soft-delete, sama pola F53/F50) — "Nonaktifkan" via Switch di
// sini yang jadi jalan keluarnya.
export function GaVendorRowActions({ vendor }: { vendor: Vendor }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: vendor.nama,
    category: vendor.category ?? "",
    contact_person: vendor.contact_person ?? "",
    phone: vendor.phone ?? "",
    contract_end: vendor.contract_end ?? "",
    active: vendor.status === "active",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-vendors/${vendor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          category: f.category.trim() || undefined,
          contact_person: f.contact_person.trim() || undefined,
          phone: f.phone.trim() || undefined,
          contract_end: f.contract_end || undefined,
          status: f.active ? "active" : "inactive",
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

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Edit" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit vendor — {vendor.nama}</DialogTitle>
          <DialogDescription>Update kontak/kontrak, atau nonaktifkan kalau sudah tidak dipakai.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gv-edit-nama">Nama</Label>
              <Input id="gv-edit-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-edit-cat">Kategori</Label>
              <Input id="gv-edit-cat" value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))} placeholder="mis. AC, Genset, IT" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-edit-cp">Kontak</Label>
              <Input id="gv-edit-cp" value={f.contact_person} onChange={(e) => setF((p) => ({ ...p, contact_person: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-edit-phone">Telepon/WA</Label>
              <Input id="gv-edit-phone" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-edit-contract">Kontrak s/d</Label>
              <Input id="gv-edit-contract" type="date" value={f.contract_end} onChange={(e) => setF((p) => ({ ...p, contract_end: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.active} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, active: v }))} />
              <Label>Aktif</Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !f.nama.trim()}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
