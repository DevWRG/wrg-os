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

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  tanggal: today(),
  vendor: "",
  am_id: "",
  customer_name: "",
  produk: "",
  produk_kategori: "",
  harga_text: "",
  harga_numeric: "",
  konteks: "",
});

const num = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export function AddCompetitorSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/competitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tanggal: f.tanggal,
          vendor: f.vendor.trim(),
          am_id: f.am_id.trim() || undefined,
          customer_name: f.customer_name.trim() || undefined,
          produk: f.produk.trim() || undefined,
          produk_kategori: f.produk_kategori.trim() || undefined,
          harga_text: f.harga_text.trim() || undefined,
          harga_numeric: num(f.harga_numeric),
          konteks: f.konteks.trim() || undefined,
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
        <Plus /> Tambah intel
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah intel kompetitor</SheetTitle>
          <SheetDescription>Catat temuan harga/produk pesaing dari lapangan.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="c-date">Tanggal *</Label>
              <Input id="c-date" type="date" required value={f.tanggal} onChange={(e) => setF((p) => ({ ...p, tanggal: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-vendor">Kompetitor *</Label>
              <Input id="c-vendor" required value={f.vendor} onChange={(e) => setF((p) => ({ ...p, vendor: e.target.value }))} placeholder="PesaingX" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-produk">Produk</Label>
              <Input id="c-produk" value={f.produk} onChange={(e) => setF((p) => ({ ...p, produk: e.target.value }))} placeholder="Tabung O2" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-kategori">Kategori produk</Label>
              <Input id="c-kategori" value={f.produk_kategori} onChange={(e) => setF((p) => ({ ...p, produk_kategori: e.target.value }))} placeholder="medical-gas" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="c-harga-text">Harga (teks)</Label>
                <Input id="c-harga-text" value={f.harga_text} onChange={(e) => setF((p) => ({ ...p, harga_text: e.target.value }))} placeholder="Rp 1,2jt" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-harga-num">Harga (angka)</Label>
                <Input id="c-harga-num" inputMode="numeric" value={f.harga_numeric} onChange={(e) => setF((p) => ({ ...p, harga_numeric: e.target.value }))} placeholder="1200000" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-am-id">AM ID</Label>
              <Input id="c-am-id" value={f.am_id} onChange={(e) => setF((p) => ({ ...p, am_id: e.target.value }))} placeholder="AM-001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-cust">Customer</Label>
              <Input id="c-cust" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} placeholder="PT Contoh" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-konteks">Konteks</Label>
              <Textarea id="c-konteks" value={f.konteks} onChange={(e) => setF((p) => ({ ...p, konteks: e.target.value }))} placeholder="Info dari customer saat kunjungan…" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
