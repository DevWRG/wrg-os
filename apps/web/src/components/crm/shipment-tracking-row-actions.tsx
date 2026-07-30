"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

interface ShipmentTracking {
  id: string;
  sj_number: string;
  customer_name: string;
  status: string;
}

interface StepDef {
  endpoint: string;
  buttonLabel: string;
  dialogTitle: string;
  confirmLabel: string;
}

// F12 — cuma 2 aksi manual (dikirim/BAST); web dipakai Admin Shipping utk
// override kalau WA hashtag #KIRIM/#BAST dari kurir gagal/tak terkirim.
const STEP_BY_STATUS: Record<string, StepDef> = {
  draft: {
    endpoint: "kirim",
    buttonLabel: "Tandai Dikirim",
    dialogTitle: "Tandai dikirim",
    confirmLabel: "Konfirmasi kirim",
  },
  dikirim: {
    endpoint: "bast",
    buttonLabel: "Tandai BAST",
    dialogTitle: "Tandai BAST (selesai)",
    confirmLabel: "Konfirmasi BAST",
  },
};

export function ShipmentTrackingRowActions({ row }: { row: ShipmentTracking }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEP_BY_STATUS[row.status];
  if (!step) return <Badge variant="secondary">Selesai</Badge>;

  async function submit() {
    if (!step) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipment-tracking/${row.id}/${step.endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
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
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {step.buttonLabel} <ArrowRight />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{step.dialogTitle}</DialogTitle>
          <DialogDescription>
            {row.sj_number} — {row.customer_name}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <p className="text-muted-foreground text-sm">
            Aksi manual ini override — normalnya status di-update otomatis lewat WA hashtag dari kurir.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : step.confirmLabel}</Button>
          <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
