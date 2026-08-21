"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";

// Cermin TRANSITIONS di apps/api/src/repo/ga-helpdesk.ts — jaga sinkron kalau
// state machine berubah.
const TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting", "completed", "cancelled"],
  waiting: ["in_progress", "cancelled"],
  completed: ["closed"],
  closed: [],
  cancelled: [],
};

// Pipeline utama (tanpa cancelled — itu aksi terpisah, destructive).
const PIPELINE: { status: string; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In Progress" },
  { status: "waiting", label: "Waiting" },
  { status: "completed", label: "Completed" },
  { status: "closed", label: "Closed" },
];

// Stepper status — SEMUA status pipeline selalu tampil sbg button (bukan
// cuma "next step" saja): status SEKARANG aktif (filled+disabled), status yg
// valid ditransisikan LANGSUNG dari sini bisa diklik, sisanya disabled abu-abu.
// "Batalkan" dipisah sbg aksi destructive sendiri (bukan bagian pipeline linear).
export function GaTicketTransitionActions({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const validNext = TRANSITIONS[status] ?? [];
  const canCancel = validNext.includes("cancelled");

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

  // Tiket cancelled — di luar pipeline linear, cuma tampilkan badge-statis via Button disabled.
  if (status === "cancelled") {
    return (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="destructive" disabled>Cancelled</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {dialog}
      {PIPELINE.map((s) => {
        const isCurrent = s.status === status;
        const isClickable = !isCurrent && validNext.includes(s.status);
        return (
          <Button
            key={s.status}
            size="sm"
            variant={isCurrent ? "default" : isClickable ? "outline" : "ghost"}
            disabled={busy || (!isCurrent && !isClickable)}
            aria-current={isCurrent ? "step" : undefined}
            onClick={isClickable ? () => act(s.status) : undefined}
            className={!isCurrent && !isClickable ? "opacity-40" : undefined}
          >
            {s.label}
          </Button>
        );
      })}
      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-danger hover:text-danger"
          onClick={() =>
            confirm(
              { title: "Batalkan tiket?", description: "Tiket akan ditutup sbg cancelled.", destructive: true, confirmLabel: "Batalkan" },
              () => act("cancelled"),
            )
          }
        >
          Batalkan
        </Button>
      )}
    </div>
  );
}
