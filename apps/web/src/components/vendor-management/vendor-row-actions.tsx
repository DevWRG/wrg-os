"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
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
import type { VendorPartnerRow } from "@/components/vendor-management/vendor-table";

const selectCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary-soft md:text-sm dark:bg-input/30";

export function VendorRowActions({ row }: { row: VendorPartnerRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: row.name,
    category: row.category ?? "",
    contact_person: row.contact_person ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    cabang: row.cabang ?? "",
    is_active: row.is_active ? "true" : "false",
    notes: row.notes ?? "",
  });

  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vendor-management/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.name.trim(),
          category: f.category.trim() || null,
          contact_person: f.contact_person.trim() || null,
          phone: f.phone.trim() || null,
          email: f.email.trim() || null,
          address: f.address.trim() || null,
          cabang: f.cabang.trim() || null,
          is_active: f.is_active === "true",
          notes: f.notes.trim() || null,
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

  function del() {
    confirm(
      {
        title: "Hapus vendor?",
        description: `Vendor "${row.name}" beserta ${row.contract_count} kontraknya akan dihapus permanen.`,
        destructive: true,
        confirmLabel: "Hapus",
      },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/vendor-management/${row.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      },
    );
  }

  return (
    <>
      {dialog}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Vendor</SheetTitle>
            <SheetDescription>{row.name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`vpe-name-${row.id}`}>Nama Vendor *</Label>
                <Input id={`vpe-name-${row.id}`} required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`vpe-category-${row.id}`}>Kategori</Label>
                <Input id={`vpe-category-${row.id}`} value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`vpe-contact-${row.id}`}>Kontak Person</Label>
                  <Input id={`vpe-contact-${row.id}`} value={f.contact_person} onChange={(e) => setF((p) => ({ ...p, contact_person: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`vpe-phone-${row.id}`}>Telepon</Label>
                  <Input id={`vpe-phone-${row.id}`} value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`vpe-email-${row.id}`}>Email</Label>
                <Input id={`vpe-email-${row.id}`} type="email" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`vpe-address-${row.id}`}>Alamat</Label>
                <Textarea id={`vpe-address-${row.id}`} value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`vpe-cabang-${row.id}`}>Cabang</Label>
                  <Input id={`vpe-cabang-${row.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`vpe-active-${row.id}`}>Status</Label>
                  <select id={`vpe-active-${row.id}`} className={selectCls} value={f.is_active} onChange={(e) => setF((p) => ({ ...p, is_active: e.target.value }))}>
                    <option value="true">Aktif</option>
                    <option value="false">Nonaktif</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`vpe-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`vpe-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
    </>
  );
}
