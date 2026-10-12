"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Download } from "lucide-react";

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
import { readFileBase64 } from "@/lib/read-file-base64";
import type { RfidCartridgeClaim } from "@/components/aftersales/rfid-cartridge-claim-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const FILE_MAX_BYTES = 8 * 1024 * 1024;
const FILE_MIME_ALLOWLIST = ["application/pdf", "image/jpeg", "image/png"];

function toForm(claim: RfidCartridgeClaim) {
  return {
    device_name: claim.device_name,
    cartridge_name: claim.cartridge_name,
    lot_number: claim.lot_number ?? "",
    serial_number: claim.serial_number ?? "",
    customer_name: claim.customer_name,
    error_description: claim.error_description,
    reported_date: claim.reported_date,
    reported_by: claim.reported_by,
    cabang: claim.cabang ?? "",
    status: claim.status,
    resolution_notes: claim.resolution_notes ?? "",
    notes: claim.notes ?? "",
  };
}

export function RfidCartridgeClaimRowActions({ claim }: { claim: RfidCartridgeClaim }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(toForm(claim));
  const [file, setFile] = useState<File | null>(null);

  const { confirm, dialog } = useConfirm();

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (picked && !FILE_MIME_ALLOWLIST.includes(picked.type)) {
      setError("File harus PDF/JPG/PNG");
      e.target.value = "";
      setFile(null);
      return;
    }
    if (picked && picked.size > FILE_MAX_BYTES) {
      setError("Ukuran file maksimal 8MB");
      e.target.value = "";
      setFile(null);
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fileFields = file
        ? { file_name: file.name, file_mime: file.type, file_base64: await readFileBase64(file) }
        : {};
      const res = await fetch(`/api/aftersales/rfid-cartridge-claims/${claim.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_name: f.device_name.trim(),
          cartridge_name: f.cartridge_name.trim(),
          lot_number: f.lot_number.trim() || null,
          serial_number: f.serial_number.trim() || null,
          customer_name: f.customer_name.trim(),
          error_description: f.error_description.trim(),
          reported_date: f.reported_date,
          reported_by: f.reported_by.trim(),
          cabang: f.cabang.trim() || null,
          status: f.status,
          resolution_notes: f.resolution_notes.trim() || null,
          notes: f.notes.trim() || null,
          ...fileFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setFile(null);
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
      { title: "Hapus klaim?", description: `Klaim "${claim.device_name} / ${claim.cartridge_name}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/aftersales/rfid-cartridge-claims/${claim.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      {claim.has_file && (
        <Button variant="ghost" size="icon-sm" aria-label="Unduh bukti" render={<a href={`/api/aftersales/rfid-cartridge-claims/${claim.id}/file`} target="_blank" rel="noreferrer" />}>
          <Download />
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (v) setF(toForm(claim));
        }}
      >
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit klaim RFID/Cartridge</SheetTitle>
            <SheetDescription>{claim.device_name} — {claim.cartridge_name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-device-${claim.id}`}>Nama Alat *</Label>
                <Input id={`rce-device-${claim.id}`} required value={f.device_name} onChange={(e) => setF((p) => ({ ...p, device_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-cartridge-${claim.id}`}>Nama/Jenis Cartridge *</Label>
                <Input id={`rce-cartridge-${claim.id}`} required value={f.cartridge_name} onChange={(e) => setF((p) => ({ ...p, cartridge_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`rce-lot-${claim.id}`}>No. Lot</Label>
                  <Input id={`rce-lot-${claim.id}`} value={f.lot_number} onChange={(e) => setF((p) => ({ ...p, lot_number: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`rce-sn-${claim.id}`}>Serial Alat</Label>
                  <Input id={`rce-sn-${claim.id}`} value={f.serial_number} onChange={(e) => setF((p) => ({ ...p, serial_number: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-customer-${claim.id}`}>Customer / RS *</Label>
                <Input id={`rce-customer-${claim.id}`} required value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-error-${claim.id}`}>Deskripsi Error *</Label>
                <Textarea id={`rce-error-${claim.id}`} required value={f.error_description} onChange={(e) => setF((p) => ({ ...p, error_description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`rce-date-${claim.id}`}>Tgl Lapor *</Label>
                  <Input id={`rce-date-${claim.id}`} type="date" required value={f.reported_date} onChange={(e) => setF((p) => ({ ...p, reported_date: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`rce-cabang-${claim.id}`}>Cabang</Label>
                  <Input id={`rce-cabang-${claim.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-reporter-${claim.id}`}>Pelapor (PIC) *</Label>
                <Input id={`rce-reporter-${claim.id}`} required value={f.reported_by} onChange={(e) => setF((p) => ({ ...p, reported_by: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-status-${claim.id}`}>Status</Label>
                <select
                  id={`rce-status-${claim.id}`}
                  className={selectCls}
                  value={f.status}
                  onChange={(e) => setF((p) => ({ ...p, status: e.target.value as RfidCartridgeClaim["status"] }))}
                >
                  <option value="pending">Menunggu</option>
                  <option value="resolved">Selesai</option>
                  <option value="rejected">Ditolak</option>
                </select>
              </div>
              {f.status !== "pending" && (
                <div className="grid gap-1.5">
                  <Label htmlFor={`rce-resolution-${claim.id}`}>Catatan Penyelesaian</Label>
                  <Textarea id={`rce-resolution-${claim.id}`} value={f.resolution_notes} onChange={(e) => setF((p) => ({ ...p, resolution_notes: e.target.value }))} />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-notes-${claim.id}`}>Catatan</Label>
                <Textarea id={`rce-notes-${claim.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rce-file-${claim.id}`}>{claim.has_file ? "Ganti Foto Bukti" : "Foto Bukti"} (PDF/JPG/PNG, maks 8MB)</Label>
                <Input id={`rce-file-${claim.id}`} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFileChange} />
                {claim.has_file && !file && <p className="text-muted-foreground text-xs">Sudah ada: {claim.file_name}. Biarkan kosong utk mempertahankan file lama.</p>}
                {file && <p className="text-muted-foreground text-xs">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
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
