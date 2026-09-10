"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

interface ScheduleRow {
  id: string;
  alat_name: string;
  status: string;
}

export function ScheduleRowActions({ row }: { row: ScheduleRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  if (row.status !== "scheduled") return null;

  async function act(action: "done" | "cancel") {
    setBusy(true);
    try {
      const res = await fetch(`/api/install-schedule/${row.id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("gagal update");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  function cancel() {
    confirm(
      { title: "Batalkan jadwal?", description: `Jadwal install ${row.alat_name} akan dibatalkan.`, destructive: true, confirmLabel: "Batalkan" },
      () => act("cancel"),
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => act("done")}>
        <CheckCircle2 /> Selesai
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={cancel} className="text-danger hover:text-danger">
        <X /> Batal
      </Button>
    </div>
  );
}
