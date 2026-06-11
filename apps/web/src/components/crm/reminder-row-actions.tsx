"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

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

interface ReminderRow {
  id: string;
  am_id: string;
  am_name: string | null;
  reminder_date: string;
  note: string;
  customer_name: string | null;
}

export function ReminderRowActions({ row, onChanged }: { row: ReminderRow; onChanged?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    am_name: row.am_name ?? "",
    reminder_date: row.reminder_date.slice(0, 10),
    customer_name: row.customer_name ?? "",
    note: row.note,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reminders/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_name: f.am_name.trim() || undefined,
          reminder_date: f.reminder_date,
          note: f.note.trim(),
          customer_name: f.customer_name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      onChanged?.();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    const who = row.am_name ?? row.am_id;
    if (!confirm(`Hapus reminder ${who} (${row.reminder_date.slice(0, 10)})?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/reminders/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("gagal hapus");
      onChanged?.();
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit reminder" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit reminder — {row.am_name ?? row.am_id}</SheetTitle>
            <SheetDescription>am_reminder #{row.id.slice(0, 8)}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`re-name-${row.id}`}>Nama AM</Label>
                <Input id={`re-name-${row.id}`} value={f.am_name} onChange={(e) => setF((p) => ({ ...p, am_name: e.target.value }))} placeholder="Budi" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`re-date-${row.id}`}>Tanggal reminder *</Label>
                <Input id={`re-date-${row.id}`} type="date" required value={f.reminder_date} onChange={(e) => setF((p) => ({ ...p, reminder_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`re-cust-${row.id}`}>Customer</Label>
                <Input id={`re-cust-${row.id}`} value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} placeholder="PT Contoh" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`re-note-${row.id}`}>Catatan *</Label>
                <Textarea id={`re-note-${row.id}`} required value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
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
      <Button variant="ghost" size="icon-sm" aria-label="Hapus reminder" disabled={busy} onClick={() => void del()}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  );
}
