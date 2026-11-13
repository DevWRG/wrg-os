"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

// Cermin TRANSITIONS di apps/api/src/repo/lpse-tender.ts — jaga sinkron
// kalau state machine berubah. Forward-only, tak ada status batal/gagal
// (blueprint F20 tak menyebutnya).
const TRANSITIONS: Record<string, string[]> = {
  pesan_masuk: ["barang_dikirim"],
  barang_dikirim: ["selesai"],
  selesai: [],
};

// Stepper penuh (pola F139 pasca-fix 2026-08-05): SEMUA status pipeline
// selalu tampil sbg button, status sekarang solid+disabled, status valid
// next bisa diklik langsung, sisanya abu-abu.
const PIPELINE: { status: string; label: string }[] = [
  { status: "pesan_masuk", label: "Pesan Masuk" },
  { status: "barang_dikirim", label: "Barang Dikirim" },
  { status: "selesai", label: "Selesai" },
];

export function LpseTenderAdvanceActions({ tenderId, status }: { tenderId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validNext = TRANSITIONS[status] ?? [];

  async function act(toStatus: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lpse-tender/${tenderId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStatus }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Gagal mengubah status (HTTP ${res.status})`);
      }
      router.refresh();
    } catch (e) {
      // Dulu ditelan diam-diam — pemakai tak tahu kliknya gagal (mis. 403
      // tanpa izin edit). Tombol tetap tersedia utk coba lagi.
      setError(e instanceof Error ? e.message : "Gagal mengubah status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
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
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
