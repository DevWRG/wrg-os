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
const blank = () => ({ am_id: "", am_name: "", tanggal: today(), items: "" });

export function AddTodoSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const items = f.items
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      setError("Minimal 1 item rencana (satu per baris).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: f.am_id.trim(),
          am_name: f.am_name.trim() || undefined,
          tanggal: f.tanggal,
          items,
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
        <Plus /> Tambah plan
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah rencana harian</SheetTitle>
          <SheetDescription>Upsert per (AM, tanggal) — submit ulang menimpa rencana hari itu.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="t-am-id">AM ID *</Label>
              <Input id="t-am-id" required value={f.am_id} onChange={(e) => setF((p) => ({ ...p, am_id: e.target.value }))} placeholder="AM-001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-am-name">Nama AM</Label>
              <Input id="t-am-name" value={f.am_name} onChange={(e) => setF((p) => ({ ...p, am_name: e.target.value }))} placeholder="Budi" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-date">Tanggal *</Label>
              <Input id="t-date" type="date" required value={f.tanggal} onChange={(e) => setF((p) => ({ ...p, tanggal: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="t-items">Item rencana * (satu per baris)</Label>
              <Textarea
                id="t-items"
                required
                rows={5}
                value={f.items}
                onChange={(e) => setF((p) => ({ ...p, items: e.target.value }))}
                placeholder={"Kunjungi PT A\nKirim penawaran PT B\nTagih invoice PT C"}
              />
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
