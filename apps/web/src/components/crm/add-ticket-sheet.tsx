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

const blank = () => ({ complaint_text: "", customer_name: "", area: "" });

export function AddTicketSheet() {
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
      const res = await fetch("/api/service-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          complaint_text: f.complaint_text.trim(),
          customer_name: f.customer_name.trim() || undefined,
          area: f.area.trim() || undefined,
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
        <Plus /> Tambah ticket
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah service ticket</SheetTitle>
          <SheetDescription>Simulasi komplain customer — severity & assign teknisi dihitung otomatis via LLM.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="st-complaint">Isi komplain *</Label>
              <Textarea
                id="st-complaint"
                required
                rows={4}
                value={f.complaint_text}
                onChange={(e) => setF((p) => ({ ...p, complaint_text: e.target.value }))}
                placeholder="mis. alat rontgen mati total, pasien menunggu..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-customer">Nama customer</Label>
              <Input id="st-customer" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-area">Area/kota (opsional)</Label>
              <Input id="st-area" value={f.area} onChange={(e) => setF((p) => ({ ...p, area: e.target.value }))} placeholder="kosongkan biar LLM yang deteksi dari teks komplain" />
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
