"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

export function DocKlaimDeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/doc-klaim/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("gagal hapus");
      router.refresh();
    } catch {
      // biarkan busy reset, tombol tetap tersedia utk retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dialog}
      <Button
        size="icon-sm"
        variant="ghost"
        title="Hapus"
        disabled={busy}
        className="text-danger hover:text-danger"
        onClick={() => confirm({ title: "Hapus klaim ini?", description: label, destructive: true, confirmLabel: "Hapus" }, doDelete)}
      >
        <Trash2 />
      </Button>
    </>
  );
}
