"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

// Cermin TRANSITIONS di apps/api/src/repo/ga-helpdesk.ts — jaga sinkron kalau
// state machine berubah.
const NEXT_STEPS: Record<string, { to: string; label: string; destructive?: boolean }[]> = {
  open: [
    { to: "in_progress", label: "Mulai Tangani" },
    { to: "cancelled", label: "Batalkan", destructive: true },
  ],
  in_progress: [
    { to: "waiting", label: "Tunda (Menunggu)" },
    { to: "completed", label: "Selesai" },
    { to: "cancelled", label: "Batalkan", destructive: true },
  ],
  waiting: [
    { to: "in_progress", label: "Lanjutkan" },
    { to: "cancelled", label: "Batalkan", destructive: true },
  ],
  completed: [{ to: "closed", label: "Tutup Tiket" }],
  closed: [],
  cancelled: [],
};

export function GaTicketTransitionActions({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const steps = NEXT_STEPS[status] ?? [];
  if (steps.length === 0) return null;

  async function act(to: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ga-tickets/${ticketId}/transition`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!res.ok) throw new Error("gagal transisi");
      router.refresh();
    } catch {
      // biarkan busy reset, error non-fatal (tombol tetap tersedia utk retry)
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      {steps.map((s) =>
        s.destructive ? (
          <Button
            key={s.to}
            size="sm"
            variant="ghost"
            disabled={busy}
            className="text-danger hover:text-danger"
            onClick={() =>
              confirm(
                { title: `${s.label}?`, description: "Tiket akan ditutup sbg cancelled.", destructive: true, confirmLabel: s.label },
                () => act(s.to),
              )
            }
          >
            {s.label}
          </Button>
        ) : (
          <Button key={s.to} size="sm" variant="outline" disabled={busy} onClick={() => act(s.to)}>
            {s.label}
          </Button>
        ),
      )}
    </div>
  );
}
