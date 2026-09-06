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

export function AddGaVendorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nama, setNama] = useState("");
  const [category, setCategory] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [contractEnd, setContractEnd] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-vendors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: nama.trim(), category: category.trim() || undefined,
          contact_person: contactPerson.trim() || undefined, phone: phone.trim() || undefined,
          contract_end: contractEnd || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setNama(""); setCategory(""); setContactPerson(""); setPhone(""); setContractEnd("");
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
        <Plus /> Tambah Vendor
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah vendor GA</DialogTitle>
          <DialogDescription>Vendor servis (AC/genset/dst) — terpisah dari vendor barang di Accurate.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gv-nama">Nama</Label>
              <Input id="gv-nama" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="PT Sejuk Abadi" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-cat">Kategori</Label>
              <Input id="gv-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="mis. AC, Genset, IT" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-cp">Kontak</Label>
              <Input id="gv-cp" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-phone">Telepon/WA</Label>
              <Input id="gv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gv-contract">Kontrak s/d</Label>
              <Input id="gv-contract" type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
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
