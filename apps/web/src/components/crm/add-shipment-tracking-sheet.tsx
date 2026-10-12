"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface AccurateShipment {
  number: string;
  customer_name: string | null;
  trans_date: string | null;
}

const blank = () => ({
  sj_number: "",
  customer_name: "",
  cabang: "",
  driver_name: "",
  driver_wa_number: "",
});

export function AddShipmentTrackingSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [shipments, setShipments] = useState<AccurateShipment[]>([]);

  useEffect(() => {
    if (!open || shipments.length > 0) return;
    void fetch("/api/shipments?limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setShipments(d?.rows ?? []))
      .catch(() => {});
  }, [open, shipments.length]);

  function pickSj(number: string) {
    const found = shipments.find((s) => s.number === number);
    setF((p) => ({ ...p, sj_number: number, customer_name: found?.customer_name ?? p.customer_name }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shipment-tracking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sj_number: f.sj_number.trim(),
          customer_name: f.customer_name.trim(),
          cabang: f.cabang.trim() || undefined,
          driver_name: f.driver_name.trim() || undefined,
          driver_wa_number: f.driver_wa_number.trim() || undefined,
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
        <Plus /> Tambah tracking
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah tracking pengiriman</SheetTitle>
          <SheetDescription>
            Pilih No. SJ dari mirror Accurate. Jarak &amp; durasi tempuh dihitung otomatis dari foto ber-geotag
            kurir saat #KIRIM &amp; #BAST — tak perlu diisi manual di sini.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="st-sj">No. SJ *</Label>
              {shipments.length > 0 ? (
                <select
                  id="st-sj"
                  required
                  className={selectCls}
                  value={f.sj_number}
                  onChange={(e) => pickSj(e.target.value)}
                >
                  <option value="" disabled>pilih SJ dari Accurate…</option>
                  {shipments.map((s) => (
                    <option key={s.number} value={s.number}>
                      {s.number} — {s.customer_name ?? "?"} ({s.trans_date?.slice(0, 10) ?? "-"})
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="st-sj"
                  required
                  value={f.sj_number}
                  onChange={(e) => setF((p) => ({ ...p, sj_number: e.target.value }))}
                  placeholder="mirror Accurate kosong — ketik manual"
                />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-customer">Customer *</Label>
              <Input
                id="st-customer"
                required
                value={f.customer_name}
                onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))}
                placeholder="mis. RS Test"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-cabang">Cabang asal</Label>
              <Input
                id="st-cabang"
                value={f.cabang}
                onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))}
                placeholder="mis. Surabaya"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-driver">Nama kurir/driver</Label>
              <Input id="st-driver" value={f.driver_name} onChange={(e) => setF((p) => ({ ...p, driver_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st-driver-wa">No. WA kurir/driver</Label>
              <Input id="st-driver-wa" value={f.driver_wa_number} onChange={(e) => setF((p) => ({ ...p, driver_wa_number: e.target.value }))} />
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
