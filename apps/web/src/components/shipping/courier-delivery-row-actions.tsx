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
import type { CourierDeliveryRow } from "./courier-delivery-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const STATUS_OPTIONS: { value: CourierDeliveryRow["status"]; label: string }[] = [
  { value: "dalam_perjalanan", label: "Dalam Perjalanan" },
  { value: "selesai", label: "Selesai" },
  { value: "bermasalah", label: "Bermasalah" },
];

export function CourierDeliveryRowActions({ row }: { row: CourierDeliveryRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    kurir_name: row.kurir_name,
    kurir_wa_number: row.kurir_wa_number ?? "",
    sj_number: row.sj_number ?? "",
    customer_name: row.customer_name ?? "",
    cabang: row.cabang ?? "",
    tanggal_kirim: row.tanggal_kirim.slice(0, 10),
    target_tiba_date: row.target_tiba_date?.slice(0, 10) ?? "",
    tanggal_tiba: row.tanggal_tiba?.slice(0, 10) ?? "",
    distance_km: row.distance_km != null ? String(row.distance_km) : "",
    status: row.status,
    notes: row.notes ?? "",
  });
  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/courier-deliveries/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kurir_name: f.kurir_name.trim(),
          kurir_wa_number: f.kurir_wa_number.trim() || null,
          sj_number: f.sj_number.trim() || null,
          customer_name: f.customer_name.trim() || null,
          cabang: f.cabang.trim() || null,
          tanggal_kirim: f.tanggal_kirim,
          target_tiba_date: f.target_tiba_date || null,
          // Kosongkan field ini (dan tak pernah terisi sebelumnya) → jangan kirim
          // key-nya sama sekali, biar backend pakai default "hari ini" saat status
          // diubah ke "selesai" (lihat komentar updateCourierDelivery). Kalau dikirim
          // eksplisit `null`, default itu tak pernah kepakai (BUG-13).
          ...(f.tanggal_tiba || row.tanggal_tiba ? { tanggal_tiba: f.tanggal_tiba || null } : {}),
          distance_km: f.distance_km ? Number(f.distance_km) : null,
          status: f.status,
          notes: f.notes.trim() || null,
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
      { title: "Hapus riwayat pengiriman?", description: `Pengiriman ${row.kurir_name} (${row.tanggal_kirim.slice(0, 10)}) akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/courier-deliveries/${row.id}`, { method: "DELETE" });
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
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit pengiriman" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Pengiriman — {row.kurir_name}</SheetTitle>
            <SheetDescription>SJ {row.sj_number ?? "—"} · {row.tanggal_kirim.slice(0, 10)}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-kurir-${row.id}`}>Kurir / Ekspedisi *</Label>
                <Input id={`cd-e-kurir-${row.id}`} required value={f.kurir_name} onChange={(e) => setF((p) => ({ ...p, kurir_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-status-${row.id}`}>Status</Label>
                <select
                  id={`cd-e-status-${row.id}`}
                  className={selectCls}
                  value={f.status}
                  onChange={(e) => setF((p) => ({ ...p, status: e.target.value as CourierDeliveryRow["status"] }))}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`cd-e-kirim-${row.id}`}>Tgl Kirim *</Label>
                  <Input id={`cd-e-kirim-${row.id}`} type="date" required value={f.tanggal_kirim} onChange={(e) => setF((p) => ({ ...p, tanggal_kirim: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`cd-e-target-${row.id}`}>Target Tiba</Label>
                  <Input id={`cd-e-target-${row.id}`} type="date" value={f.target_tiba_date} onChange={(e) => setF((p) => ({ ...p, target_tiba_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-tiba-${row.id}`}>Tgl Tiba Aktual</Label>
                <Input id={`cd-e-tiba-${row.id}`} type="date" value={f.tanggal_tiba} onChange={(e) => setF((p) => ({ ...p, tanggal_tiba: e.target.value }))} />
                <p className="text-muted-foreground text-xs">Kosongkan bila belum tiba — status &quot;Selesai&quot; tanpa tanggal ini otomatis diisi hari ini.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`cd-e-cabang-${row.id}`}>Cabang</Label>
                  <Input id={`cd-e-cabang-${row.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`cd-e-distance-${row.id}`}>Jarak (km)</Label>
                  <Input id={`cd-e-distance-${row.id}`} type="number" min="0" step="any" value={f.distance_km} onChange={(e) => setF((p) => ({ ...p, distance_km: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-customer-${row.id}`}>Customer</Label>
                <Input id={`cd-e-customer-${row.id}`} value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-sj-${row.id}`}>No. Surat Jalan</Label>
                <Input id={`cd-e-sj-${row.id}`} value={f.sj_number} onChange={(e) => setF((p) => ({ ...p, sj_number: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-wa-${row.id}`}>No. WA Kurir</Label>
                <Input id={`cd-e-wa-${row.id}`} value={f.kurir_wa_number} onChange={(e) => setF((p) => ({ ...p, kurir_wa_number: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`cd-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`cd-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
      <Button variant="ghost" size="icon-sm" aria-label="Hapus pengiriman" disabled={busy} onClick={() => void del()}>
        <Trash2 className="text-destructive" />
      </Button>
    </div>
  );
}
