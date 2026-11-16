"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", waiting: "Waiting", completed: "Completed", closed: "Closed",
};

// Satu tombol "Ubah status" berisi transisi yang sah saja. Dulu stepper 5
// status + Batalkan selalu tampil — di tabel /ga-helpdesk kolom Aksi jadi
// terlalu lebar dan terpotong di kanan (laporan user 16 Nov). Status sekarang
// sudah tampil di kolom Status, jadi tak perlu diulang di sini.
export function GaTicketTransitionActions({ ticketId, status }: { ticketId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const validNext = TRANSITIONS[status] ?? [];
  const maju = validNext.filter((s) => s !== "cancelled");
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

  // closed / cancelled — status akhir, tak ada aksi.
  if (validNext.length === 0) return null;

  return (
    <>
      {dialog}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
          Ubah status <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {maju.map((s) => (
            <DropdownMenuItem key={s} onClick={() => act(s)}>
              {LABEL[s] ?? s}
            </DropdownMenuItem>
          ))}
          {canCancel && maju.length > 0 && <DropdownMenuSeparator />}
          {canCancel && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                confirm(
                  { title: "Batalkan tiket?", description: "Tiket akan ditutup sbg cancelled.", destructive: true, confirmLabel: "Batalkan" },
                  () => act("cancelled"),
                )
              }
            >
              Batalkan
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
