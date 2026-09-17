"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

// Approval reimburse — generik, siapa pun user login boleh decide (Owner
// blueprint kosong, tak ada rule resmi soal approver). Forward-only, cermin
// TRANSITIONS di apps/api/src/repo/doc-klaim.ts:
//   baru -> disetujui|ditolak -> dibayar (hanya dari disetujui)
export function DocKlaimApproval({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"disetujui" | "ditolak" | null>(null);
  const [nominal, setNominal] = useState("");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "disetujui" | "ditolak") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-klaim/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          nominal_disetujui: decision === "disetujui" && nominal.trim() ? Number(nominal) : undefined,
          catatan: catatan.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal simpan");
      setOpen(null);
      setNominal("");
      setCatatan("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function bayar() {
    setBusy(true);
    try {
      const res = await fetch(`/api/doc-klaim/${id}/bayar`, { method: "POST" });
      if (!res.ok) throw new Error("gagal tandai dibayar");
      router.refresh();
    } catch {
      // biarkan busy reset, tombol tetap tersedia utk retry
    } finally {
      setBusy(false);
    }
  }

  if (status === "baru") {
    return (
      <div className="flex gap-1">
        <Dialog open={open === "disetujui"} onOpenChange={(o) => setOpen(o ? "disetujui" : null)}>
          <DialogTrigger render={<Button size="sm" disabled={busy} />}>
            <Check /> Setujui
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Setujui klaim</DialogTitle>
              <DialogDescription>Nominal opsional — kosongkan kalau sesuai nota (tak diubah).</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Nominal disetujui (opsional)</Label>
                <Input type="number" value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="Sesuai nota" />
              </div>
              <div className="grid gap-1.5">
                <Label>Catatan</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Opsional" />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button disabled={busy} onClick={() => decide("disetujui")}>{busy ? "Menyimpan…" : "Setujui"}</Button>
              <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={open === "ditolak"} onOpenChange={(o) => setOpen(o ? "ditolak" : null)}>
          <DialogTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
            <X /> Tolak
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Tolak klaim</DialogTitle>
              <DialogDescription>Isi alasan penolakan (opsional, tapi sebaiknya diisi).</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Alasan</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. nota tidak jelas / bukan kebutuhan kantor" />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button variant="destructive" disabled={busy} onClick={() => decide("ditolak")}>{busy ? "Menyimpan…" : "Tolak"}</Button>
              <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (status === "disetujui") {
    return (
      <Button size="sm" disabled={busy} onClick={bayar}>
        {busy ? "Menyimpan…" : "Tandai Dibayar"}
      </Button>
    );
  }

  return null; // ditolak/dibayar — terminal, tak ada aksi lanjutan
}
