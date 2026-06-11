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

const blank = () => ({
  am_id: "",
  nama: "",
  panggilan: "",
  wa_number: "",
  role: "AM",
  posisi: "",
  cabang: "",
  area: "",
  aktif: true,
  wajib_plan_report: true,
});

export function AddUserSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const set = (k: keyof ReturnType<typeof blank>, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: f.am_id.trim(),
          nama: f.nama.trim(),
          panggilan: f.panggilan.trim() || undefined,
          wa_number: f.wa_number.trim() || undefined,
          role: f.role.trim() || undefined,
          posisi: f.posisi.trim() || undefined,
          cabang: f.cabang.trim() || undefined,
          area: f.area.trim() || undefined,
          aktif: f.aktif,
          wajib_plan_report: f.wajib_plan_report,
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
        <Plus /> Tambah user
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah / update user</SheetTitle>
          <SheetDescription>Upsert master_user (per am_id). am_id yang sama menimpa data lama.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="u-id">am_id *</Label>
                <Input id="u-id" required value={f.am_id} onChange={(e) => set("am_id", e.target.value)} placeholder="100" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="u-panggilan">Panggilan</Label>
                <Input id="u-panggilan" value={f.panggilan} onChange={(e) => set("panggilan", e.target.value)} placeholder="Budi" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-nama">Nama lengkap *</Label>
              <Input id="u-nama" required value={f.nama} onChange={(e) => set("nama", e.target.value)} placeholder="Budi Santoso" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="u-role">Role</Label>
                <Input id="u-role" value={f.role} onChange={(e) => set("role", e.target.value)} placeholder="AM" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="u-posisi">Posisi</Label>
                <Input id="u-posisi" value={f.posisi} onChange={(e) => set("posisi", e.target.value)} placeholder="Account Manager" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="u-cabang">Cabang</Label>
                <Input id="u-cabang" value={f.cabang} onChange={(e) => set("cabang", e.target.value)} placeholder="Surabaya" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="u-area">Area</Label>
                <Input id="u-area" value={f.area} onChange={(e) => set("area", e.target.value)} placeholder="East" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="u-wa">WA number</Label>
              <Input id="u-wa" value={f.wa_number} onChange={(e) => set("wa_number", e.target.value)} placeholder="628xxxxxxxxxx" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.aktif} onChange={(e) => set("aktif", e.target.checked)} className="size-4" />
                Aktif
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.wajib_plan_report} onChange={(e) => set("wajib_plan_report", e.target.checked)} className="size-4" />
                Wajib plan/report
              </label>
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
