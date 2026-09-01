"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface AssetOption { id: string; asset_code: string; nama: string; category_id: string }
interface VendorOption { id: string; nama: string }
interface CategoryOption { id: string; default_recur_months: number | null }

const NONE = "__none__";

// Auto-fill "Berulang (bulan)" dari default kategori aset begitu aset
// dipilih (mis. "Kendaraan Bermotor"=6, "AC"=3 — contoh dari brief F137,
// admin set sendiri per kategori) — tetap bisa diubah manual sesudahnya.
export function AddGaMaintenanceButton({ assets, vendors, categories }: { assets: AssetOption[]; vendors: VendorOption[]; categories: CategoryOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetId, setAssetId] = useState("");
  const [maintType, setMaintType] = useState("preventive");
  const [dueDate, setDueDate] = useState("");
  const [costBudget, setCostBudget] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [recurMonths, setRecurMonths] = useState("0");
  const [notes, setNotes] = useState("");

  function selectAsset(id: string) {
    setAssetId(id);
    const asset = assets.find((a) => a.id === id);
    const cat = asset ? categories.find((c) => c.id === asset.category_id) : undefined;
    if (cat?.default_recur_months != null) setRecurMonths(String(cat.default_recur_months));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-maintenance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId, maint_type: maintType, due_date: dueDate || undefined,
          cost_budget: costBudget ? Number(costBudget) : undefined, vendor_id: vendorId || undefined,
          recur_months: recurMonths ? Number(recurMonths) : undefined, notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setAssetId(""); setDueDate(""); setCostBudget(""); setVendorId(""); setRecurMonths("0"); setNotes("");
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
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Jadwalkan Maintenance
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Jadwalkan maintenance</DialogTitle>
          <DialogDescription>Preventive (rutin) atau repair (perbaikan).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Aset</Label>
              <Select value={assetId || NONE} onValueChange={(v) => selectAsset(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih aset">{(v: string) => (v === NONE ? "Pilih aset" : (() => { const a = assets.find((x) => x.id === v); return a ? `${a.asset_code} — ${a.nama}` : v; })())}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— pilih —</SelectItem>
                  {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Tipe</Label>
                <Select value={maintType} onValueChange={(v) => setMaintType(v ?? "preventive")}>
                  <SelectTrigger><SelectValue>{(v: string) => (v === "preventive" ? "Preventive" : "Repair")}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preventive">Preventive</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gm-due">Due Date</Label>
                <Input id="gm-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="gm-budget">Budget (Rp)</Label>
                <Input id="gm-budget" type="number" min={0} value={costBudget} onChange={(e) => setCostBudget(e.target.value)} placeholder="opsional" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gm-recur">Berulang (bulan)</Label>
                <Input id="gm-recur" type="number" min={0} max={60} value={recurMonths} onChange={(e) => setRecurMonths(e.target.value)} placeholder="0 = sekali" />
                <p className="text-muted-foreground text-xs">Auto-isi dari default kategori aset, bisa diubah.</p>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Vendor</Label>
              <Select value={vendorId || NONE} onValueChange={(v) => setVendorId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Opsional">{(v: string) => (v === NONE ? "— tidak ada —" : vendors.find((x) => x.id === v)?.nama ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— tidak ada —</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gm-notes">Catatan</Label>
              <Textarea id="gm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !assetId}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
