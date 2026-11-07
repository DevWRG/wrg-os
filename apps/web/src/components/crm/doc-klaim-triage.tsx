"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const KATEGORI_LABEL: Record<string, string> = {
  kebutuhan_kantor: "Kebutuhan Kantor",
  perjalanan_dinas: "Perjalanan Dinas",
  lainnya: "Lainnya",
};
const NONE = "__none__";

// Triage kategori — LLM sengaja TIDAK diminta menebak ini (struk taksi mis.
// ambigu kantor/dinas tanpa konteks), staf pilih manual. Terpisah dari
// approval (lihat DocKlaimApproval) — dua keputusan berbeda, dua komponen.
export function DocKlaimTriage({ id, initialKategori }: { id: string; initialKategori: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kategori, setKategori] = useState(initialKategori ?? NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-klaim/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kategori: kategori === NONE ? null : kategori }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal simpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Pencil /> Kategori
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kategori klaim</DialogTitle>
          <DialogDescription>Pilih manual — foto struk tak selalu jelas kantor atau dinas.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Kategori</Label>
            <Select value={kategori} onValueChange={(v) => setKategori(v ?? NONE)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === NONE ? "— belum ditriage —" : KATEGORI_LABEL[v] ?? v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— belum ditriage —</SelectItem>
                {Object.entries(KATEGORI_LABEL).map(([k, lbl]) => (
                  <SelectItem key={k} value={k}>{lbl}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button disabled={busy} onClick={save}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
