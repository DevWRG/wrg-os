"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, History, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Vehicle {
  id: string;
  plate_number: string;
  model: string | null;
  sopir_name: string | null;
  current_km: number | null;
  stnk_expiry: string | null;
  service_interval_km: number;
  active: boolean;
}

interface VehicleLog {
  id: string;
  log_type: string;
  log_date: string;
  km: number | null;
  bbm_liter: number | null;
  bbm_cost: number | null;
  note: string | null;
}

const LOG_TYPE_LABEL: Record<string, string> = { km: "Update KM", bbm: "Isi BBM", service: "Service" };

function AddLogDialog({ vehicle }: { vehicle: Vehicle }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ log_type: "km", km: "", bbm_liter: "", bbm_cost: "", note: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}/logs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          log_type: f.log_type,
          km: f.km ? Number(f.km) : undefined,
          bbm_liter: f.bbm_liter ? Number(f.bbm_liter) : undefined,
          bbm_cost: f.bbm_cost ? Number(f.bbm_cost) : undefined,
          note: f.note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ log_type: "km", km: "", bbm_liter: "", bbm_cost: "", note: "" });
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
      <DialogTrigger render={<Button size="sm" variant="outline" title="Tambah log" />}>
        <Plus />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah log — {vehicle.plate_number}</DialogTitle>
          <DialogDescription>Update KM, isi BBM, atau catat service selesai.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="vl-type">Jenis</Label>
              <select
                id="vl-type"
                className={selectCls}
                value={f.log_type}
                onChange={(e) => setF((p) => ({ ...p, log_type: e.target.value }))}
              >
                <option value="km">Update KM</option>
                <option value="bbm">Isi BBM</option>
                <option value="service">Service</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vl-km">KM {f.log_type === "service" ? "saat service" : "sekarang"} *</Label>
              <Input id="vl-km" type="number" min="0" required value={f.km} onChange={(e) => setF((p) => ({ ...p, km: e.target.value }))} />
            </div>
            {f.log_type === "bbm" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="vl-liter">Liter *</Label>
                  <Input id="vl-liter" type="number" min="0" step="0.1" required value={f.bbm_liter} onChange={(e) => setF((p) => ({ ...p, bbm_liter: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="vl-cost">Biaya (Rp) *</Label>
                  <Input id="vl-cost" type="number" min="0" required value={f.bbm_cost} onChange={(e) => setF((p) => ({ ...p, bbm_cost: e.target.value }))} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="vl-note">Catatan (opsional)</Label>
              <Textarea id="vl-note" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ vehicle }: { vehicle: Vehicle }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<VehicleLog[] | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch(`/api/vehicles/${vehicle.id}/logs`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLogs(d?.logs ?? []));
  }, [open, vehicle.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Riwayat" />}>
        <History />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Riwayat — {vehicle.plate_number}</DialogTitle>
          <DialogDescription>100 entri terakhir.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {logs === null ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada entri log.</p>
          ) : (
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-2 pr-4 whitespace-nowrap">Tanggal</th>
                    <th className="py-2 pr-4 whitespace-nowrap">Jenis</th>
                    <th className="py-2 pr-4 whitespace-nowrap">KM</th>
                    <th className="py-2 pr-4 whitespace-nowrap">BBM</th>
                    <th className="py-2">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5 pr-4 whitespace-nowrap">{l.log_date}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{LOG_TYPE_LABEL[l.log_type] ?? l.log_type}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{l.km ?? "-"}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{l.bbm_liter ? `${l.bbm_liter} L` : "-"}</td>
                      <td className="py-1.5">{l.note ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ vehicle }: { vehicle: Vehicle }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    sopir_name: vehicle.sopir_name ?? "",
    stnk_expiry: vehicle.stnk_expiry ?? "",
    service_interval_km: String(vehicle.service_interval_km),
    active: vehicle.active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sopir_name: f.sopir_name.trim() || undefined,
          stnk_expiry: f.stnk_expiry || undefined,
          service_interval_km: f.service_interval_km ? Number(f.service_interval_km) : undefined,
          active: f.active,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
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
      <DialogTrigger render={<Button size="sm" variant="outline" title="Edit" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit — {vehicle.plate_number}</DialogTitle>
          <DialogDescription>Update sopir, STNK (reset alert kalau tanggal baru), interval service.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ve-sopir">Sopir *</Label>
              <Input id="ve-sopir" required value={f.sopir_name} onChange={(e) => setF((p) => ({ ...p, sopir_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ve-stnk">STNK jatuh tempo *</Label>
              <Input id="ve-stnk" type="date" required value={f.stnk_expiry} onChange={(e) => setF((p) => ({ ...p, stnk_expiry: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ve-interval">Interval service (km) *</Label>
              <Input id="ve-interval" type="number" min="1" required value={f.service_interval_km} onChange={(e) => setF((p) => ({ ...p, service_interval_km: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.active} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, active: v }))} />
              <Label>Aktif</Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VehicleRowActions({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div className="flex justify-end gap-1.5">
      <AddLogDialog vehicle={vehicle} />
      <HistoryDialog vehicle={vehicle} />
      <EditDialog vehicle={vehicle} />
    </div>
  );
}
