"use client";

import { useState } from "react";
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

interface InstallationUnit {
  id: string;
  alat_name: string;
  status: string;
}

interface StepDef {
  endpoint: string;
  buttonLabel: string;
  dialogTitle: string;
  field: string;
  fieldLabel: string;
  required: boolean;
  placeholder?: string;
}

const STEP_BY_STATUS: Record<string, StepDef> = {
  draft: {
    endpoint: "po-control",
    buttonLabel: "Tandai PO Control",
    dialogTitle: "Tandai PO Control selesai",
    field: "po_number",
    fieldLabel: "No. PO",
    required: false,
  },
  po_control: {
    endpoint: "sj",
    buttonLabel: "Tandai SJ",
    dialogTitle: "Tandai SJ (Surat Jalan) selesai",
    field: "sj_number",
    fieldLabel: "No. SJ *",
    required: true,
  },
  sj: {
    endpoint: "assign-teknisi",
    buttonLabel: "Assign Teknisi",
    dialogTitle: "Assign teknisi",
    field: "teknisi_name",
    fieldLabel: "Nama teknisi *",
    required: true,
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

  const step = STEP_BY_STATUS[row.status];
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
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setValue(""); setError(null); } }}>
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
              <Input
                id={`iu-step-${row.id}`}
                required={step.required}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={step.placeholder}
              />
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
