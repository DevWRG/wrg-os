"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface InstallationUnit {
  id: string;
  alat_name: string;
  status: string;
  po_number: string | null;
}

interface Shipment {
  number: string;
  customer_name: string | null;
  trans_date: string | null;
}

interface StepDef {
  endpoint: string;
  buttonLabel: string;
  dialogTitle: string;
  field: string;
  fieldLabel: string;
  required: boolean;
  placeholder?: string;
  sourceFromAccurate?: boolean; // No. SJ dipilih dari mirror Accurate (exception disetujui utk F22)
  sourceFromRoster?: boolean;   // Teknisi dipilih dari roster teknisi_capacity (F8), bukan diketik
}

const STEP_BY_STATUS: Record<string, StepDef> = {
  draft: {
    endpoint: "po-control",
    buttonLabel: "Tandai PO Control",
    dialogTitle: "Tandai PO Control selesai",
    field: "po_number",
    fieldLabel: "No. PO *",
    required: true,
  },
  po_control: {
    endpoint: "sj",
    buttonLabel: "Tandai SJ",
    dialogTitle: "Tandai SJ (Surat Jalan) selesai",
    field: "sj_number",
    fieldLabel: "No. SJ *",
    required: true,
    sourceFromAccurate: true,
  },
  sj: {
    endpoint: "assign-teknisi",
    buttonLabel: "Assign Teknisi",
    dialogTitle: "Assign teknisi",
    // Nilai yang dikirim kini teknisi_id (uuid roster), bukan nama. Nama
    // di-snapshot server-side di markTeknisiAssign.
    field: "teknisi_id",
    fieldLabel: "Teknisi *",
    required: true,
    sourceFromRoster: true,
  },
  teknisi_assign: {
    endpoint: "training",
    buttonLabel: "Training Selesai",
    dialogTitle: "Tandai training selesai",
    field: "training_notes",
    fieldLabel: "Catatan training",
    required: false,
    placeholder: "opsional",
  },
  training: {
    endpoint: "bast",
    buttonLabel: "Tandai BAST",
    dialogTitle: "Tandai BAST (lifecycle selesai)",
    field: "bast_number",
    fieldLabel: "No. BAST *",
    required: true,
  },
};

export function InstallationRowActions({ row }: { row: InstallationUnit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [teknisi, setTeknisi] = useState<{ id: string; nama: string }[]>([]);

  const step = STEP_BY_STATUS[row.status];

  useEffect(() => {
    if (!open || !step?.sourceFromAccurate || shipments.length > 0) return;
    void fetch("/api/shipments?limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setShipments(d?.rows ?? []))
      .catch(() => {});
  }, [open, step?.sourceFromAccurate, shipments.length]);

  // Roster teknisi utk langkah assign. Hanya yang AKTIF ditawarkan — menugaskan
  // teknisi nonaktif tersimpan wajar tapi orangnya sudah tak di roster, jadi
  // server pun menolaknya; menyaring di sini supaya tak sampai ke situ.
  useEffect(() => {
    if (!open || !step?.sourceFromRoster || teknisi.length > 0) return;
    void fetch("/api/teknisi-capacity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setTeknisi(
          (d?.teknisi ?? [])
            .filter((t: { aktif?: boolean }) => t.aktif !== false)
            .map((t: { id: string; nama: string }) => ({ id: String(t.id), nama: String(t.nama) })),
        ),
      )
      .catch(() => {});
  }, [open, step?.sourceFromRoster, teknisi.length]);

  if (!step) return <Badge variant="secondary">Selesai</Badge>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/installations/${row.id}/${step.endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [step.field]: value.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setValue("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // No. PO bisa saja sudah diisi saat unit dibuat (create form) —
          // pre-fill biar user gak dipaksa ngetik ulang nilai yg udah ada,
          // "required" cuma efektif kalau memang belum ada.
          setValue(step.field === "po_number" ? (row.po_number ?? "") : "");
        } else {
          setValue("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {step.buttonLabel} <ArrowRight />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{step.dialogTitle}</DialogTitle>
          <DialogDescription>{row.alat_name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`iu-step-${row.id}`}>{step.fieldLabel}</Label>
              {step.sourceFromRoster ? (
                <select
                  id={`iu-step-${row.id}`}
                  required={step.required}
                  className={selectCls}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                >
                  <option value="" disabled>
                    {teknisi.length === 0 ? "roster teknisi kosong — isi dulu di menu Readiness Board" : "pilih teknisi…"}
                  </option>
                  {teknisi.map((t) => (
                    <option key={t.id} value={t.id}>{t.nama}</option>
                  ))}
                </select>
              ) : step.sourceFromAccurate && shipments.length > 0 ? (
                <select
                  id={`iu-step-${row.id}`}
                  required={step.required}
                  className={selectCls}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
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
                  id={`iu-step-${row.id}`}
                  required={step.required}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={step.sourceFromAccurate ? "mirror Accurate kosong — ketik manual" : step.placeholder}
                />
              )}
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
