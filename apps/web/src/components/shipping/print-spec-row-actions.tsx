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
import { PAPER_SIZE_OPTIONS, ORIENTATION_OPTIONS, selectCls } from "./print-spec-options";
import type { PrintSpecRow } from "./print-spec-table";

export function PrintSpecRowActions({ row }: { row: PrintSpecRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    document_type: row.document_type,
    paper_size: row.paper_size,
    orientation: row.orientation,
    margin_top_mm: String(row.margin_top_mm),
    margin_right_mm: String(row.margin_right_mm),
    margin_bottom_mm: String(row.margin_bottom_mm),
    margin_left_mm: String(row.margin_left_mm),
    font_family: row.font_family,
    font_size_pt: String(row.font_size_pt),
    has_letterhead: row.has_letterhead,
    header_spec: row.header_spec ?? "",
    footer_spec: row.footer_spec ?? "",
    notes: row.notes ?? "",
    is_active: row.is_active,
  });
  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/print-specs/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document_type: f.document_type.trim(),
          paper_size: f.paper_size,
          orientation: f.orientation,
          margin_top_mm: Number(f.margin_top_mm),
          margin_right_mm: Number(f.margin_right_mm),
          margin_bottom_mm: Number(f.margin_bottom_mm),
          margin_left_mm: Number(f.margin_left_mm),
          font_family: f.font_family.trim(),
          font_size_pt: Number(f.font_size_pt),
          has_letterhead: f.has_letterhead,
          header_spec: f.header_spec.trim() || null,
          footer_spec: f.footer_spec.trim() || null,
          notes: f.notes.trim() || null,
          is_active: f.is_active,
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
      { title: "Hapus spec cetak?", description: `Standar cetak untuk "${row.document_type}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/print-specs/${row.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit spec cetak" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Spec Cetak — {row.document_type}</SheetTitle>
            <SheetDescription>Standar cetak dokumen (F44).</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`ps-e-doctype-${row.id}`}>Jenis Dokumen *</Label>
                <Input id={`ps-e-doctype-${row.id}`} required value={f.document_type} onChange={(e) => setF((p) => ({ ...p, document_type: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`ps-e-paper-${row.id}`}>Ukuran Kertas</Label>
                  <select id={`ps-e-paper-${row.id}`} className={selectCls} value={f.paper_size} onChange={(e) => setF((p) => ({ ...p, paper_size: e.target.value as PrintSpecRow["paper_size"] }))}>
                    {PAPER_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`ps-e-orient-${row.id}`}>Orientasi</Label>
                  <select id={`ps-e-orient-${row.id}`} className={selectCls} value={f.orientation} onChange={(e) => setF((p) => ({ ...p, orientation: e.target.value as PrintSpecRow["orientation"] }))}>
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
                  <Label htmlFor={`ps-e-font-${row.id}`}>Font</Label>
                  <Input id={`ps-e-font-${row.id}`} value={f.font_family} onChange={(e) => setF((p) => ({ ...p, font_family: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`ps-e-fontsize-${row.id}`}>Ukuran Font (pt)</Label>
                  <Input id={`ps-e-fontsize-${row.id}`} type="number" min="0" step="0.5" value={f.font_size_pt} onChange={(e) => setF((p) => ({ ...p, font_size_pt: e.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.has_letterhead} onChange={(e) => setF((p) => ({ ...p, has_letterhead: e.target.checked }))} />
                Pakai Letterhead (kop surat)
              </label>
              <div className="grid gap-1.5">
                <Label htmlFor={`ps-e-header-${row.id}`}>Elemen Header</Label>
                <Textarea id={`ps-e-header-${row.id}`} value={f.header_spec} onChange={(e) => setF((p) => ({ ...p, header_spec: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ps-e-footer-${row.id}`}>Elemen Footer</Label>
                <Textarea id={`ps-e-footer-${row.id}`} value={f.footer_spec} onChange={(e) => setF((p) => ({ ...p, footer_spec: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ps-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`ps-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.is_active} onChange={(e) => setF((p) => ({ ...p, is_active: e.target.checked }))} />
                Aktif
              </label>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
            <SheetFooter>
              <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
              <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <Button variant="ghost" size="icon-sm" aria-label="Hapus spec cetak" disabled={busy} onClick={() => void del()}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  );
}
