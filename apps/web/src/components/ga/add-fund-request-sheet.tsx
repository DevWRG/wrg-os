"use client";

import { useEffect, useState } from "react";
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

const today = () => new Date().toISOString().slice(0, 10);
// Pola native <select> yang sama dgn add-leave-sheet.tsx / add-purchase-order-sheet.tsx.
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const blank = () => ({
  purpose: "",
  amount_requested: "",
  cabang: "",
  request_date: today(),
  hod_approver_key: "",
  notes: "",
});

interface HodOption {
  id: string;
  name: string | null;
  email: string;
  hod_key: string;
}

// requester_name/requester_email TIDAK diminta di form — diisi otomatis dari
// sesi login di BFF (apps/web/src/app/api/fund-requests/route.ts), bukan
// dikirim dari client (identitas pengaju harus dipercaya dari server, bukan
// body request).
export function AddFundRequestSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [hods, setHods] = useState<HodOption[]>([]);

  useEffect(() => {
    if (!open || hods.length > 0) return;
    void fetch("/api/fund-requests/hod-options", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setHods(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [open, hods.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.hod_approver_key) {
      setError("HOD approver wajib dipilih");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fund-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: f.purpose.trim(),
          amount_requested: Number(f.amount_requested),
          cabang: f.cabang.trim() || undefined,
          request_date: f.request_date,
          hod_approver_key: f.hod_approver_key,
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
        <Plus /> Ajukan Dana
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Ajukan Dana Operasional</SheetTitle>
          <SheetDescription>Pengajuan akan mengalir ke HOD terpilih, lalu Direktur (F138).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="fr-purpose">Keperluan *</Label>
              <Input id="fr-purpose" required value={f.purpose} onChange={(e) => setF((p) => ({ ...p, purpose: e.target.value }))} placeholder="mis. Operasional kunjungan cabang" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="fr-amount">Jumlah (Rp) *</Label>
                <Input id="fr-amount" type="number" min="0" step="any" required value={f.amount_requested} onChange={(e) => setF((p) => ({ ...p, amount_requested: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fr-date">Tgl Pengajuan *</Label>
                <Input id="fr-date" type="date" required value={f.request_date} onChange={(e) => setF((p) => ({ ...p, request_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fr-cabang">Cabang</Label>
              <Input id="fr-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fr-hod">HOD Approver *</Label>
              <select
                id="fr-hod"
                required
                className={selectCls}
                value={f.hod_approver_key}
                onChange={(e) => setF((p) => ({ ...p, hod_approver_key: e.target.value }))}
              >
                <option value="" disabled>Pilih HOD…</option>
                {hods.map((h) => (
                  <option key={h.hod_key} value={h.hod_key}>{h.name ?? h.email}</option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">Tier-1 approver — setelah disetujui HOD ini, lanjut ke Direktur.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fr-notes">Catatan</Label>
              <Textarea id="fr-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Ajukan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
