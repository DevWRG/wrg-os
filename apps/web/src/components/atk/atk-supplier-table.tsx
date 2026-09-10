"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
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

export interface AtkSupplierRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
}

function SupplierRowActions({ row }: { row: AtkSupplierRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: row.name,
    contact_person: row.contact_person ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
  });
  const { confirm, dialog } = useConfirm();

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/atk/suppliers/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "gagal menyimpan");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch({
        name: f.name.trim(),
        contact_person: f.contact_person.trim() || null,
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        address: f.address.trim() || null,
        notes: f.notes.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await patch({ is_active: !row.is_active });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function del() {
    confirm({ title: "Hapus pemasok?", description: `"${row.name}" akan dihapus. Barang yang masih memakai pemasok ini akan kehilangan referensinya.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/atk/suppliers/${row.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("gagal hapus");
        router.refresh();
      } catch {
        setBusy(false);
      }
    });
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Button variant="ghost" size="sm" disabled={busy} onClick={toggleActive}>
        {row.is_active ? "Nonaktifkan" : "Aktifkan"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Pemasok ATK</SheetTitle>
            <SheetDescription>{row.name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`as-e-name-${row.id}`}>Nama *</Label>
                <Input id={`as-e-name-${row.id}`} required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`as-e-cp-${row.id}`}>Contact Person</Label>
                <Input id={`as-e-cp-${row.id}`} value={f.contact_person} onChange={(e) => setF((p) => ({ ...p, contact_person: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`as-e-phone-${row.id}`}>Telepon</Label>
                  <Input id={`as-e-phone-${row.id}`} value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`as-e-email-${row.id}`}>Email</Label>
                  <Input id={`as-e-email-${row.id}`} type="email" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`as-e-addr-${row.id}`}>Alamat</Label>
                <Textarea id={`as-e-addr-${row.id}`} value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`as-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`as-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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

const columns: DataColumn<AtkSupplierRow>[] = [
  { id: "name", header: "Nama", sortable: true, accessor: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
  { id: "cp", header: "Contact Person", sortable: true, accessor: (r) => r.contact_person ?? "", cell: (r) => r.contact_person ?? "—" },
  { id: "phone", header: "Telepon", accessor: (r) => r.phone ?? "", cell: (r) => r.phone ?? "—" },
  { id: "email", header: "Email", accessor: (r) => r.email ?? "", cell: (r) => r.email ?? "—" },
  { id: "status", header: "Status", cell: (r) => (r.is_active ? <Badge className="bg-success/10 text-success">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>) },
  { id: "aksi", header: "Aksi", align: "right", cell: (r) => <SupplierRowActions row={r} /> },
];

export function AtkSupplierTable({ rows }: { rows: AtkSupplierRow[] }) {
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari pemasok…" pageSize={25} />;
}
