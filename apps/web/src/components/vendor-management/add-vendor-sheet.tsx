"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const blank = () => ({
  name: "",
  category: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  cabang: "",
  notes: "",
});

export function AddVendorSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vendor-management", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.name.trim(),
          category: f.category.trim() || undefined,
          contact_person: f.contact_person.trim() || undefined,
          phone: f.phone.trim() || undefined,
          email: f.email.trim() || undefined,
          address: f.address.trim() || undefined,
          cabang: f.cabang.trim() || undefined,
          notes: f.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank());
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus /> Tambah Vendor
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Vendor</SheetTitle>
          <SheetDescription>Catat vendor/partner baru ke master lokal.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="vp-name">Nama Vendor *</Label>
              <Input id="vp-name" required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vp-category">Kategori</Label>
              <Input id="vp-category" value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))} placeholder="Mis. supplier / jasa / partner" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="vp-contact">Kontak Person</Label>
                <Input id="vp-contact" value={f.contact_person} onChange={(e) => setF((p) => ({ ...p, contact_person: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="vp-phone">Telepon</Label>
                <Input id="vp-phone" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vp-email">Email</Label>
              <Input id="vp-email" type="email" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vp-address">Alamat</Label>
              <Textarea id="vp-address" value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vp-cabang">Cabang</Label>
              <Input id="vp-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vp-notes">Catatan</Label>
              <Textarea id="vp-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
