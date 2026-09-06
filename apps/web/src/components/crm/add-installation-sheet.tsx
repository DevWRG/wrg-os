"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { CatalogPicker, type CatalogChoice } from "@/components/crm/catalog-picker";

// Alat & customer TIDAK lagi diketik bebas — wajib dipilih dari mirror Accurate
// (keputusan Direktur 2026-08-28). Yang dikirim ke API adalah id-nya; nama
// di-snapshot server-side dari mirror, jadi klien tak bisa mengarang nama untuk
// id yang benar.
const blank = () => ({ serial_number: "", cabang: "", po_number: "" });

export function AddInstallationSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [alat, setAlat] = useState<CatalogChoice | null>(null);
  const [cust, setCust] = useState<CatalogChoice | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!alat || !cust) {
        throw new Error("Alat & customer wajib dipilih dari katalog Accurate");
      }
      const res = await fetch("/api/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: alat.id,
          account_id: cust.id,
          serial_number: f.serial_number.trim() || undefined,
          cabang: f.cabang.trim() || undefined,
          po_number: f.po_number.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank());
      setAlat(null);
      setCust(null);
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
        <Plus /> Tambah unit instalasi
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah unit instalasi</SheetTitle>
          <SheetDescription>Checklist lifecycle dimulai dari langkah PO control.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="iu-alat">Alat * <span className="text-muted-foreground text-xs">(dari katalog Accurate)</span></Label>
              <CatalogPicker
                entity="items"
                inputId="iu-alat"
                required
                value={alat}
                onChange={setAlat}
                placeholder="cari nama/kode alat…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iu-serial">Serial number *</Label>
              <Input id="iu-serial" required value={f.serial_number} onChange={(e) => setF((p) => ({ ...p, serial_number: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iu-customer">Customer * <span className="text-muted-foreground text-xs">(dari mirror Accurate)</span></Label>
              <CatalogPicker
                entity="customers"
                inputId="iu-customer"
                required
                value={cust}
                onChange={setCust}
                placeholder="cari nama/kode customer…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iu-cabang">Cabang</Label>
              <Input id="iu-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iu-po">No. PO</Label>
              <Input id="iu-po" value={f.po_number} onChange={(e) => setF((p) => ({ ...p, po_number: e.target.value }))} placeholder="diisi kalau sudah ada, ditandai selesai lewat aksi checklist" />
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
