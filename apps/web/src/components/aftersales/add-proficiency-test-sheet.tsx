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
import { readFileAsBase64 } from "@/lib/read-file-base64";

// Cap 8MB & mime pdf/jpg/jpeg/png — diasumsikan (belum ada arahan eksplisit
// Direktur soal batas ini), ditegakkan jg di server (apps/api/src/index.ts).
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

const today = () => new Date().toISOString().slice(0, 10);

const blank = () => ({
  rs_name: "",
  test_name: "",
  provider: "",
  cert_number: "",
  issued_date: today(),
  expired_date: "",
  cabang: "",
  pic: "",
  notes: "",
});

export function AddProficiencyTestSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (picked && !ACCEPTED_MIME.includes(picked.type)) {
      setError("File harus PDF/JPG/PNG");
      e.target.value = "";
      return;
    }
    if (picked && picked.size > MAX_FILE_BYTES) {
      setError("Ukuran file maksimal 8MB");
      e.target.value = "";
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
      const filePayload = file
        ? { file_base64: await readFileAsBase64(file), file_name: file.name, file_mime: file.type }
        : {};
      const res = await fetch("/api/aftersales/proficiency-tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rs_name: f.rs_name.trim(),
          test_name: f.test_name.trim(),
          provider: f.provider.trim() || undefined,
          cert_number: f.cert_number.trim() || undefined,
          issued_date: f.issued_date || undefined,
          expired_date: f.expired_date,
          cabang: f.cabang.trim() || undefined,
          pic: f.pic.trim() || undefined,
          notes: f.notes.trim() || undefined,
          ...filePayload,
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
        <Plus /> Tambah Dokumen
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Dokumen Uji Profisiensi</SheetTitle>
          <SheetDescription>Sertifikat uji profisiensi per RS/faskes, beserta tanggal ED untuk tracking renewal tahunan.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pt-rs">RS / Faskes *</Label>
              <Input id="pt-rs" required value={f.rs_name} onChange={(e) => setF((p) => ({ ...p, rs_name: e.target.value }))} placeholder="RS ABC" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-test">Uji Profisiensi *</Label>
              <Input id="pt-test" required value={f.test_name} onChange={(e) => setF((p) => ({ ...p, test_name: e.target.value }))} placeholder="Hematologi / Kimia Klinik / dst." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pt-provider">Penyelenggara</Label>
                <Input id="pt-provider" value={f.provider} onChange={(e) => setF((p) => ({ ...p, provider: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pt-cert">No. Sertifikat</Label>
                <Input id="pt-cert" value={f.cert_number} onChange={(e) => setF((p) => ({ ...p, cert_number: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pt-issued">Tgl Terbit</Label>
                <Input id="pt-issued" type="date" value={f.issued_date} onChange={(e) => setF((p) => ({ ...p, issued_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pt-expired">Tgl ED *</Label>
                <Input id="pt-expired" type="date" required value={f.expired_date} onChange={(e) => setF((p) => ({ ...p, expired_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pt-cabang">Cabang</Label>
                <Input id="pt-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pt-pic">PIC</Label>
                <Input id="pt-pic" value={f.pic} onChange={(e) => setF((p) => ({ ...p, pic: e.target.value }))} placeholder="Penanggung jawab" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-file">Sertifikat (PDF/JPG/PNG, maks 8MB)</Label>
              <Input id="pt-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFileChange} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-notes">Catatan</Label>
              <Textarea id="pt-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
