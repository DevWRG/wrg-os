"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Combobox } from "@/components/ui/combobox";


interface Teknisi {
  id: string;
  nama: string;
}

const blank = () => ({ teknisi_id: "", report_type: "install", body: "" });

export function AddReportSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [teknisi, setTeknisi] = useState<Teknisi[]>([]);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/teknisi-capacity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTeknisi(d?.teknisi ?? []))
      .catch(() => {});
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/teknisi-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          teknisi_id: f.teknisi_id || undefined,
          report_type: f.report_type,
          body: f.body.trim(),
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
      <SheetTrigger render={<Button size="sm" variant="outline" />}>
        <Plus /> Tambah laporan (manual/testing)
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah laporan lapangan</SheetTitle>
          <SheetDescription>Simulasi laporan #install/#servis/#training/#kalibrasi tanpa lewat WA.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ar-teknisi">Teknisi</Label>
              <Combobox
                id="ar-teknisi"
                value={f.teknisi_id}
                onChange={(v) => setF((p) => ({ ...p, teknisi_id: v }))}
                options={teknisi.map((t) => ({ value: t.id, label: t.nama }))}
                emptyOption="tidak diketahui"
                placeholder="tidak diketahui"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ar-jenis">Jenis *</Label>
              <Combobox
                id="ar-jenis"
                value={f.report_type}
                onChange={(v) => setF((p) => ({ ...p, report_type: v || p.report_type }))}
                options={["install", "servis", "training", "kalibrasi"].map((j) => ({ value: j, label: `#${j}` }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ar-body">Isi laporan *</Label>
              <Textarea id="ar-body" required rows={4} value={f.body} onChange={(e) => setF((p) => ({ ...p, body: e.target.value }))} placeholder="mis. alat X terpasang lancar, sudah dites nyala" />
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
