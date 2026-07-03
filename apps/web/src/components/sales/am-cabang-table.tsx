"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { selectClass } from "@/components/watchpoint/hod-options";

// Tabel mapping AM → Cabang. Ganti cabang di dropdown → simpan langsung
// (PUT /api/admin/am-cabang). Cabang menentukan region kartu Sales Performance
// (via hod_territory). Opsi cabang = daftar cabang di WatchPoint Territory.

export interface AmRow {
  am_id: string;
  nama: string;
  panggilan: string | null;
  cabang: string | null;
  aktif: boolean;
}
type Status = "idle" | "saving" | "saved" | "error";

export function AmCabangTable({ rows, cabangOptions }: { rows: AmRow[]; cabangOptions: string[] }) {
  const [cabang, setCabang] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.am_id, r.cabang ?? ""])),
  );
  const [status, setStatus] = useState<Record<string, Status>>({});

  async function save(am_id: string, value: string) {
    setCabang((p) => ({ ...p, [am_id]: value }));
    setStatus((p) => ({ ...p, [am_id]: "saving" }));
    try {
      const res = await fetch("/api/admin/am-cabang", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ am_id, cabang: value || null }),
      });
      if (!res.ok) throw new Error();
      setStatus((p) => ({ ...p, [am_id]: "saved" }));
    } catch {
      setStatus((p) => ({ ...p, [am_id]: "error" }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="py-2 pr-4 font-medium">AM</th>
            <th className="px-2 py-2 font-medium">Cabang</th>
            <th className="px-2 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const st = status[r.am_id] ?? "idle";
            return (
              <tr key={r.am_id} className="border-t">
                <td className="py-2 pr-4">
                  <div className="font-medium">{r.panggilan || r.nama}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.nama}{!r.aktif && " · nonaktif"}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <select
                    className={selectClass}
                    value={cabang[r.am_id] ?? ""}
                    onChange={(e) => save(r.am_id, e.target.value)}
                  >
                    <option value="">— (kosong)</option>
                    {cabangOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  {st === "saving" ? (
                    <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  ) : st === "saved" ? (
                    <span className="text-success flex items-center gap-1 text-xs"><Check className="size-3.5" /> Tersimpan</span>
                  ) : st === "error" ? (
                    <span className="text-danger flex items-center gap-1 text-xs"><X className="size-3.5" /> Gagal</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
