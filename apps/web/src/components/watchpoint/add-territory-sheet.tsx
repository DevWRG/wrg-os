"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { HOD_OPTIONS, selectClass } from "@/components/watchpoint/hod-options";

export function AddTerritorySheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hodKey, setHodKey] = useState(HOD_OPTIONS[0].key);
  const [cabang, setCabang] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/watchpoint/territory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hod_key: hodKey, cabang: cabang.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setCabang("");
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
        <Plus /> Tambah mapping
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah mapping HoD→cabang</SheetTitle>
          <SheetDescription>Cabang harus sama persis dengan master_user.cabang.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="t-hod">HoD *</Label>
              <select id="t-hod" className={selectClass} value={hodKey} onChange={(e) => setHodKey(e.target.value)}>
                {HOD_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-cabang">Cabang *</Label>
              <Input id="t-cabang" required value={cabang} onChange={(e) => setCabang(e.target.value)} placeholder="BALI" />
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
