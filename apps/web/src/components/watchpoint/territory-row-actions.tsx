"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { HOD_OPTIONS, hodLabel, selectClass } from "@/components/watchpoint/hod-options";

export function TerritoryRowActions({ id, hod_key, cabang }: { id: string; hod_key: string; cabang: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hod, setHod] = useState(hod_key);
  const [cab, setCab] = useState(cabang);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchpoint/territory/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hod_key: hod, cabang: cab.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Hapus mapping "${hodLabel(hod_key)} → ${cabang}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/watchpoint/territory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("gagal hapus");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit mapping</SheetTitle>
            <SheetDescription>{hodLabel(hod_key)} → {cabang}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`te-hod-${id}`}>HoD *</Label>
                <select id={`te-hod-${id}`} className={selectClass} value={hod} onChange={(e) => setHod(e.target.value)}>
                  {HOD_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`te-cab-${id}`}>Cabang *</Label>
                <Input id={`te-cab-${id}`} required value={cab} onChange={(e) => setCab(e.target.value)} />
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
      <Button variant="ghost" size="icon-sm" aria-label="Hapus" disabled={busy} onClick={del} className="text-danger hover:text-danger">
        <Trash2 />
      </Button>
    </div>
  );
}
