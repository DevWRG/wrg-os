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
const blank = (date?: string) => ({ am_id: "", am_name: "", reminder_date: date || today(), customer_name: "", note: "" });

interface AmOption {
  am_id: string;
  name: string;
  cabang: string | null;
}

export function AddReminderSheet({
  ams,
  defaultDate,
  onCreated,
}: {
  /** Bila diberikan → pilih AM via dropdown (am_id + nama otomatis). */
  ams?: AmOption[];
  defaultDate?: string;
  /** Dipanggil setelah sukses (mis. untuk refresh data client-fetch). */
  onCreated?: () => void;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank(defaultDate));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: f.am_id.trim(),
          am_name: f.am_name.trim() || undefined,
          reminder_date: f.reminder_date,
          note: f.note.trim(),
          customer_name: f.customer_name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank(defaultDate));
      setOpen(false);
      onCreated?.();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button className="shrink-0" />}>
        <Plus /> Tambah reminder
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah reminder</SheetTitle>
          <SheetDescription>Reminder AM untuk aksi tertentu (am_reminder).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            {ams && ams.length > 0 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="r-am">Account Manager *</Label>
                <select
                  id="r-am"
                  required
                  value={f.am_id}
                  onChange={(e) => {
                    const sel = ams.find((a) => a.am_id === e.target.value);
                    setF((p) => ({ ...p, am_id: e.target.value, am_name: sel?.name ?? "" }));
                  }}
                  className="border-input bg-card h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
                >
                  <option value="" disabled>Pilih AM…</option>
                  {ams.map((a) => (
                    <option key={a.am_id} value={a.am_id}>{a.name}{a.cabang ? ` (${a.cabang})` : ""}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="r-am-id">AM ID *</Label>
                  <Input id="r-am-id" required value={f.am_id} onChange={(e) => setF((p) => ({ ...p, am_id: e.target.value }))} placeholder="AM-001" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="r-am-name">Nama AM</Label>
                  <Input id="r-am-name" value={f.am_name} onChange={(e) => setF((p) => ({ ...p, am_name: e.target.value }))} placeholder="Budi" />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="r-date">Tanggal reminder *</Label>
              <Input id="r-date" type="date" required value={f.reminder_date} onChange={(e) => setF((p) => ({ ...p, reminder_date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-cust">Customer</Label>
              <Input id="r-cust" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} placeholder="PT Contoh" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="r-note">Catatan *</Label>
              <Textarea id="r-note" required value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="Follow up penawaran…" />
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
