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
import { Combobox } from "@/components/ui/combobox";


interface EligibleUnit {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  bast_at: string | null;
}
interface Teknisi {
  id: string;
  nama: string;
  wa_number: string | null;
  aktif: boolean;
}

const blank = () => ({
  installation_unit_id: "",
  interval_bulan: "6",
  reference_date: "",
  teknisi_id: "",
});

export function AddMaintenanceSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [units, setUnits] = useState<EligibleUnit[]>([]);
  const [teknisiRoster, setTeknisiRoster] = useState<Teknisi[]>([]);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/maintenance/eligible-units", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUnits(d?.units ?? []))
      .catch(() => {});
    // Roster F8 (teknisi_capacity) — teknisi PM WAJIB dipilih dari sini
    // (migrasi 207). Dulu nama+WA bisa diketik manual, dan PM dengan nama
    // ketikan tak terhitung di beban Readiness Board. Teknisi yang belum ada
    // ditambahkan dulu di Readiness Board.
    void fetch("/api/teknisi-capacity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTeknisiRoster(d?.teknisi ?? []))
      .catch(() => {});
  }, [open]);

  function selectUnit(id: string) {
    const u = units.find((x) => x.id === id);
    setF((p) => ({ ...p, installation_unit_id: id, reference_date: u?.bast_at ? u.bast_at.slice(0, 10) : "" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installation_unit_id: f.installation_unit_id,
          interval_bulan: Number(f.interval_bulan),
          reference_date: f.reference_date || undefined,
          teknisi_id: f.teknisi_id || undefined,
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
        <Plus /> Tambah schedule
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah schedule PM/kalibrasi</SheetTitle>
          <SheetDescription>Alat harus sudah BAST (lifecycle instalasi selesai) & belum punya schedule.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ms-unit">Alat *</Label>
              <Combobox
                id="ms-unit"
                value={f.installation_unit_id}
                onChange={selectUnit}
                options={units.map((u) => ({ value: u.id, label: `${u.alat_name} — ${u.customer_name}` }))}
                placeholder={units.length === 0 ? "tidak ada alat eligible" : "pilih alat…"}
                disabled={units.length === 0}
              />
              <input type="text" required value={f.installation_unit_id} onChange={() => {}} className="sr-only" tabIndex={-1} aria-hidden />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-interval">Interval (bulan) *</Label>
              <Input
                id="ms-interval"
                type="number"
                min={1}
                required
                value={f.interval_bulan}
                onChange={(e) => setF((p) => ({ ...p, interval_bulan: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-ref">Tanggal acuan</Label>
              <Input
                id="ms-ref"
                type="date"
                value={f.reference_date}
                onChange={(e) => setF((p) => ({ ...p, reference_date: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-teknisi">Teknisi</Label>
              <Combobox
                id="ms-teknisi"
                value={f.teknisi_id}
                onChange={(v) => setF((p) => ({ ...p, teknisi_id: v }))}
                options={teknisiRoster.filter((t) => t.aktif).map((t) => ({ value: t.id, label: `${t.nama}${t.wa_number ? "" : " (tanpa no. WA)"}` }))}
                emptyOption="— belum ditugaskan —"
                placeholder="— belum ditugaskan —"
              />
              <p className="text-muted-foreground text-xs">
                Dipilih dari roster Readiness Board. Belum ada di daftar? Tambahkan dulu di Readiness Board. Reminder H-14 dikirim ke no. WA di roster.
              </p>
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
