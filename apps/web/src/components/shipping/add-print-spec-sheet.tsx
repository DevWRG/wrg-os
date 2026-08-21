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
import { PAPER_SIZE_OPTIONS, ORIENTATION_OPTIONS, selectCls } from "./print-spec-options";

const blank = () => ({
  document_type: "",
  paper_size: "A4" as const,
  orientation: "portrait" as const,
  margin_top_mm: "20",
  margin_right_mm: "20",
  margin_bottom_mm: "20",
  margin_left_mm: "20",
  font_family: "Arial",
  font_size_pt: "11",
  has_letterhead: true,
  header_spec: "",
  footer_spec: "",
  notes: "",
});

// Definisikan standar cetak baru per jenis dokumen (F44). document_type teks
// bebas — tidak ada roster jenis dokumen di project ini (lihat komentar
// migrasi 096), unique case-insensitive ditegakkan di server.
export function AddPrintSpecSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.document_type.trim()) {
      setError("Jenis dokumen wajib diisi");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/print-specs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document_type: f.document_type.trim(),
          paper_size: f.paper_size,
          orientation: f.orientation,
          margin_top_mm: Number(f.margin_top_mm),
          margin_right_mm: Number(f.margin_right_mm),
          margin_bottom_mm: Number(f.margin_bottom_mm),
          margin_left_mm: Number(f.margin_left_mm),
          font_family: f.font_family.trim() || undefined,
          font_size_pt: Number(f.font_size_pt),
          has_letterhead: f.has_letterhead,
          header_spec: f.header_spec.trim() || undefined,
          footer_spec: f.footer_spec.trim() || undefined,
          notes: f.notes.trim() || undefined,
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
        <Plus /> Tambah Spec Cetak
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Spec Cetak</SheetTitle>
          <SheetDescription>Standar cetak per jenis dokumen (F44).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ps-doctype">Jenis Dokumen *</Label>
              <Input id="ps-doctype" required value={f.document_type} onChange={(e) => setF((p) => ({ ...p, document_type: e.target.value }))} placeholder="mis. Surat Jalan (SJ) / BAST / TTF" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ps-paper">Ukuran Kertas</Label>
                <select id="ps-paper" className={selectCls} value={f.paper_size} onChange={(e) => setF((p) => ({ ...p, paper_size: e.target.value as typeof f.paper_size }))}>
                  {PAPER_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ps-orient">Orientasi</Label>
                <select id="ps-orient" className={selectCls} value={f.orientation} onChange={(e) => setF((p) => ({ ...p, orientation: e.target.value as typeof f.orientation }))}>
                  {ORIENTATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Margin (mm) — Atas/Kanan/Bawah/Kiri</Label>
              <div className="grid grid-cols-4 gap-2">
                <Input type="number" min="0" step="1" value={f.margin_top_mm} onChange={(e) => setF((p) => ({ ...p, margin_top_mm: e.target.value }))} aria-label="Margin atas" />
                <Input type="number" min="0" step="1" value={f.margin_right_mm} onChange={(e) => setF((p) => ({ ...p, margin_right_mm: e.target.value }))} aria-label="Margin kanan" />
                <Input type="number" min="0" step="1" value={f.margin_bottom_mm} onChange={(e) => setF((p) => ({ ...p, margin_bottom_mm: e.target.value }))} aria-label="Margin bawah" />
                <Input type="number" min="0" step="1" value={f.margin_left_mm} onChange={(e) => setF((p) => ({ ...p, margin_left_mm: e.target.value }))} aria-label="Margin kiri" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ps-font">Font</Label>
                <Input id="ps-font" value={f.font_family} onChange={(e) => setF((p) => ({ ...p, font_family: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ps-fontsize">Ukuran Font (pt)</Label>
                <Input id="ps-fontsize" type="number" min="0" step="0.5" value={f.font_size_pt} onChange={(e) => setF((p) => ({ ...p, font_size_pt: e.target.value }))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.has_letterhead} onChange={(e) => setF((p) => ({ ...p, has_letterhead: e.target.checked }))} />
              Pakai Letterhead (kop surat)
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="ps-header">Elemen Header</Label>
              <Textarea id="ps-header" value={f.header_spec} onChange={(e) => setF((p) => ({ ...p, header_spec: e.target.value }))} placeholder="mis. Logo kiri atas, Nama Perusahaan, Alamat, No. Telp" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ps-footer">Elemen Footer</Label>
              <Textarea id="ps-footer" value={f.footer_spec} onChange={(e) => setF((p) => ({ ...p, footer_spec: e.target.value }))} placeholder="mis. Kolom tanda tangan, nomor halaman" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ps-notes">Catatan</Label>
              <Textarea id="ps-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
