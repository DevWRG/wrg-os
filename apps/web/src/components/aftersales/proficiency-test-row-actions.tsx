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
import { readFileAsBase64 } from "@/lib/read-file-base64";
import type { ProficiencyTestRow } from "@/components/aftersales/proficiency-test-table";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

export function ProficiencyTestRowActions({ row }: { row: ProficiencyTestRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    rs_name: row.rs_name,
    test_name: row.test_name,
    provider: row.provider ?? "",
    cert_number: row.cert_number ?? "",
    issued_date: row.issued_date ?? "",
    expired_date: row.expired_date,
    cabang: row.cabang ?? "",
    pic: row.pic ?? "",
    notes: row.notes ?? "",
  });
  const [file, setFile] = useState<File | null>(null);

  const { confirm, dialog } = useConfirm();

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const filePayload = file
        ? { file_base64: await readFileAsBase64(file), file_name: file.name, file_mime: file.type }
        : {};
      const res = await fetch(`/api/aftersales/proficiency-tests/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rs_name: f.rs_name.trim(),
          test_name: f.test_name.trim(),
          provider: f.provider.trim() || null,
          cert_number: f.cert_number.trim() || null,
          issued_date: f.issued_date || null,
          expired_date: f.expired_date,
          cabang: f.cabang.trim() || null,
          pic: f.pic.trim() || null,
          notes: f.notes.trim() || null,
          ...filePayload,
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
      { title: "Hapus dokumen?", description: `Sertifikat "${row.test_name}" (${row.rs_name}) akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/aftersales/proficiency-tests/${row.id}`, { method: "DELETE" });
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Dokumen Uji Profisiensi</SheetTitle>
            <SheetDescription>{row.rs_name} — {row.test_name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`pte-rs-${row.id}`}>RS / Faskes *</Label>
                <Input id={`pte-rs-${row.id}`} required value={f.rs_name} onChange={(e) => setF((p) => ({ ...p, rs_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`pte-test-${row.id}`}>Uji Profisiensi *</Label>
                <Input id={`pte-test-${row.id}`} required value={f.test_name} onChange={(e) => setF((p) => ({ ...p, test_name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-provider-${row.id}`}>Penyelenggara</Label>
                  <Input id={`pte-provider-${row.id}`} value={f.provider} onChange={(e) => setF((p) => ({ ...p, provider: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-cert-${row.id}`}>No. Sertifikat</Label>
                  <Input id={`pte-cert-${row.id}`} value={f.cert_number} onChange={(e) => setF((p) => ({ ...p, cert_number: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-issued-${row.id}`}>Tgl Terbit</Label>
                  <Input id={`pte-issued-${row.id}`} type="date" value={f.issued_date} onChange={(e) => setF((p) => ({ ...p, issued_date: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-expired-${row.id}`}>Tgl ED *</Label>
                  <Input id={`pte-expired-${row.id}`} type="date" required value={f.expired_date} onChange={(e) => setF((p) => ({ ...p, expired_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-cabang-${row.id}`}>Cabang</Label>
                  <Input id={`pte-cabang-${row.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`pte-pic-${row.id}`}>PIC</Label>
                  <Input id={`pte-pic-${row.id}`} value={f.pic} onChange={(e) => setF((p) => ({ ...p, pic: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`pte-file-${row.id}`}>
                  Ganti Sertifikat {row.has_file ? `(saat ini: ${row.file_name ?? "ada file"})` : "(belum ada file)"}
                </Label>
                <Input id={`pte-file-${row.id}`} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFileChange} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`pte-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`pte-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
