"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface PendingLeave {
  id: number;
  am_id: string;
  nama: string;
  jenis: string;
  start_date: string;
  end_date: string;
  status: string;
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function PendingLeaveTable({ pending }: { pending: PendingLeave[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function decide(id: number, approve: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/leave/pending/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Gagal: ${j.error ?? res.status}`);
      } else {
        router.refresh();
      }
    } catch {
      alert("Gagal menghubungi server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b">
          <tr className="text-left">
            <th className="py-2 pr-3">Nama</th>
            <th className="py-2 pr-3">Jenis</th>
            <th className="py-2 pr-3">Tanggal</th>
            <th className="py-2 pr-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">{p.nama}</td>
              <td className="py-2 pr-3"><Badge variant="secondary">{p.jenis}</Badge></td>
              <td className="py-2 pr-3 text-muted-foreground">
                {p.start_date === p.end_date ? tgl(p.start_date) : `${tgl(p.start_date)} – ${tgl(p.end_date)}`}
              </td>
              <td className="py-2 pr-3">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p.id, true)}>
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => decide(p.id, false)}>
                    <X className="size-4" /> Tolak
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
