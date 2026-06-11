"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

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

interface UserRow {
  am_id: string;
  nama: string;
  panggilan: string | null;
  wa_number: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  area: string | null;
  aktif: boolean;
  wajib_plan_report: boolean;
}

export function UserRowActions({ user }: { user: UserRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: user.nama,
    panggilan: user.panggilan ?? "",
    wa_number: user.wa_number ?? "",
    role: user.role,
    posisi: user.posisi ?? "",
    cabang: user.cabang ?? "",
    area: user.area ?? "",
    aktif: user.aktif,
    wajib_plan_report: user.wajib_plan_report,
  });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: user.am_id,
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
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit user — {user.panggilan ?? user.am_id}</SheetTitle>
            <SheetDescription>am_id {user.am_id} · nonaktifkan via toggle Aktif.</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`ue-nama-${user.am_id}`}>Nama lengkap *</Label>
                <Input id={`ue-nama-${user.am_id}`} required value={f.nama} onChange={(e) => set("nama", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`ue-pang-${user.am_id}`}>Panggilan</Label>
                  <Input id={`ue-pang-${user.am_id}`} value={f.panggilan} onChange={(e) => set("panggilan", e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`ue-role-${user.am_id}`}>Role</Label>
                  <Input id={`ue-role-${user.am_id}`} value={f.role} onChange={(e) => set("role", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`ue-pos-${user.am_id}`}>Posisi</Label>
                  <Input id={`ue-pos-${user.am_id}`} value={f.posisi} onChange={(e) => set("posisi", e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`ue-cab-${user.am_id}`}>Cabang</Label>
                  <Input id={`ue-cab-${user.am_id}`} value={f.cabang} onChange={(e) => set("cabang", e.target.value)} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ue-wa-${user.am_id}`}>WA number</Label>
                <Input id={`ue-wa-${user.am_id}`} value={f.wa_number} onChange={(e) => set("wa_number", e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.aktif} onChange={(e) => set("aktif", e.target.checked)} className="size-4" /> Aktif
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.wajib_plan_report} onChange={(e) => set("wajib_plan_report", e.target.checked)} className="size-4" /> Wajib plan/report
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
    </div>
  );
}
