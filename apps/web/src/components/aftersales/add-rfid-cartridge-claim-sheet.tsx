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
import { readFileBase64 } from "@/lib/read-file-base64";

// Cap & mime harus sinkron dgn apps/api/src/index.ts (RFID_CLAIM_FILE_MAX_BYTES/
// RFID_CLAIM_FILE_MIME_ALLOWLIST) — validasi client cuma UX, server yg menegakkan.
const FILE_MAX_BYTES = 8 * 1024 * 1024;
const FILE_MIME_ALLOWLIST = ["application/pdf", "image/jpeg", "image/png"];

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  device_name: "",
  cartridge_name: "",
  lot_number: "",
  serial_number: "",
  customer_name: "",
  error_description: "",
  reported_date: today(),
  reported_by: "",
  cabang: "",
  notes: "",
});

export function AddRfidCartridgeClaimSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [file, setFile] = useState<File | null>(null);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fileFields = file
        ? { file_name: file.name, file_mime: file.type, file_base64: await readFileBase64(file) }
        : {};
      const res = await fetch("/api/aftersales/rfid-cartridge-claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          device_name: f.device_name.trim(),
          cartridge_name: f.cartridge_name.trim(),
          lot_number: f.lot_number.trim() || undefined,
          serial_number: f.serial_number.trim() || undefined,
          customer_name: f.customer_name.trim(),
          error_description: f.error_description.trim(),
          reported_date: f.reported_date,
          reported_by: f.reported_by.trim(),
          cabang: f.cabang.trim() || undefined,
          notes: f.notes.trim() || undefined,
          ...fileFields,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank());
      setFile(null);
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
        <Plus /> Lapor Klaim
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Lapor error RFID/Cartridge</SheetTitle>
          <SheetDescription>Catat kejadian error pembacaan RFID pada alat + cartridge.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="rc-device">Nama Alat *</Label>
              <Input id="rc-device" required value={f.device_name} onChange={(e) => setF((p) => ({ ...p, device_name: e.target.value }))} placeholder="mis. Point-of-Care Analyzer XYZ" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-cartridge">Nama/Jenis Cartridge *</Label>
              <Input id="rc-cartridge" required value={f.cartridge_name} onChange={(e) => setF((p) => ({ ...p, cartridge_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rc-lot">No. Lot</Label>
                <Input id="rc-lot" value={f.lot_number} onChange={(e) => setF((p) => ({ ...p, lot_number: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rc-sn">Serial Alat</Label>
                <Input id="rc-sn" value={f.serial_number} onChange={(e) => setF((p) => ({ ...p, serial_number: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-customer">Customer / RS *</Label>
              <Input id="rc-customer" required value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-error">Deskripsi Error *</Label>
              <Textarea id="rc-error" required value={f.error_description} onChange={(e) => setF((p) => ({ ...p, error_description: e.target.value }))} placeholder="Gejala / kode error RFID yang muncul…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rc-date">Tgl Lapor *</Label>
                <Input id="rc-date" type="date" required value={f.reported_date} onChange={(e) => setF((p) => ({ ...p, reported_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rc-cabang">Cabang</Label>
                <Input id="rc-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-reporter">Pelapor (PIC) *</Label>
              <Input id="rc-reporter" required value={f.reported_by} onChange={(e) => setF((p) => ({ ...p, reported_by: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-notes">Catatan</Label>
              <Textarea id="rc-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-file">Foto Bukti (PDF/JPG/PNG, maks 8MB)</Label>
              <Input id="rc-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFileChange} />
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
  );
}
