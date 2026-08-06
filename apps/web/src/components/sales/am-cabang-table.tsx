"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";

import { selectClass } from "@/components/watchpoint/hod-options";

// Tabel mapping AM → Cabang + Golongan. Ganti dropdown → simpan langsung
// (PUT /api/admin/am-cabang). Cabang menentukan region kartu Sales Performance
// (via hod_territory). Golongan = jenjang karir SK Pasal 2.1, jadi sumber target
// customer & new-customer aspek NPK AM. Opsi cabang = WatchPoint Territory.

export interface AmRow {
  am_id: string;
  nama: string;
  panggilan: string | null;
  cabang: string | null;
  aktif: boolean;
  golongan: string | null;
  target_customer: number | null; // turunan golongan (SK Pasal 2.1), read-only
}
export interface GolonganOption { key: string; label: string; target_customer: number | null }
type Status = "idle" | "saving" | "saved" | "error";

export function AmCabangTable({
  rows, cabangOptions, golonganOptions,
}: {
  rows: AmRow[]; cabangOptions: string[]; golonganOptions: GolonganOption[];
}) {
  const [cabang, setCabang] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.am_id, r.cabang ?? ""])),
  );
  const [golongan, setGolongan] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.am_id, r.golongan ?? ""])),
  );
  const [status, setStatus] = useState<Record<string, Status>>({});
  const targetOf = (g: string): number | null =>
    golonganOptions.find((o) => o.key === g)?.target_customer ?? null;

  // Kirim HANYA field yang diubah — field yang tak dikirim tidak disentuh backend.
  async function save(am_id: string, patch: { cabang?: string | null; golongan?: string | null }) {
    if (patch.cabang !== undefined) setCabang((p) => ({ ...p, [am_id]: patch.cabang ?? "" }));
    if (patch.golongan !== undefined) setGolongan((p) => ({ ...p, [am_id]: patch.golongan ?? "" }));
    setStatus((p) => ({ ...p, [am_id]: "saving" }));
    try {
      const res = await fetch("/api/admin/am-cabang", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ am_id, ...patch }),
      });
      if (!res.ok) throw new Error();
      setStatus((p) => ({ ...p, [am_id]: "saved" }));
    } catch {
      setStatus((p) => ({ ...p, [am_id]: "error" }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <th className="py-2 pr-4 font-medium">AM</th>
            <th className="px-2 py-2 font-medium">Cabang</th>
            <th className="px-2 py-2 font-medium">Golongan <span className="font-normal">(SK Pasal 2.1)</span></th>
            <th className="px-2 py-2 font-medium">Target Customer</th>
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
                    onChange={(e) => save(r.am_id, { cabang: e.target.value || null })}
                  >
                    <option value="">— (kosong)</option>
                    {cabangOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    className={selectClass}
                    aria-label={`Golongan ${r.nama}`}
                    value={golongan[r.am_id] ?? ""}
                    onChange={(e) => save(r.am_id, { golongan: e.target.value || null })}
                  >
                    <option value="">— belum di-assessment —</option>
                    {golonganOptions.map((g) => (
                      <option key={g.key} value={g.key}>{g.key} · {g.label}</option>
                    ))}
                  </select>
                </td>
                <td className="text-muted-foreground px-2 py-2 text-xs tabular-nums">
                  {(() => {
                    const t = targetOf(golongan[r.am_id] ?? "");
                    return t == null ? "—" : `${t} faskes`;
                  })()}
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
