"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

export function DocKlaimDeleteButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-klaim/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "gagal hapus");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
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
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
