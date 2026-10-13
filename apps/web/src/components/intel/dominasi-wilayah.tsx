"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import type { SelDominasi } from "./types";

const STATUS_CLS = {
  dikonfirmasi: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  ditolak: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

// F131 — kompetitor dominan per cabang × kategori. "Dugaan" = ≥5 sebutan dan
// satu vendor ≥60%; HoD mengonfirmasi/menolak (cabang timnya), admin semua.
export function DominasiWilayah({ sel, hari, bolehUbah }: { sel: SelDominasi[]; hari: number; bolehUbah: boolean }) {
  const router = useRouter();
  const [cabang, setCabang] = useState("");
  const [semua, setSemua] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const opsiCabang = useMemo(() => [...new Set(sel.map((s) => s.cabang))].sort().map((c) => ({ value: c, label: c })), [sel]);
  const tampil = sel.filter((s) => (!cabang || s.cabang === cabang) && (semua || s.dugaan || s.status));

  async function tetapkan(s: SelDominasi, status: "dikonfirmasi" | "ditolak" | "hapus") {
    const k = `${s.cabang}|${s.kategori}`;
    setBusy(k);
    setErr(null);
    try {
      const res = await fetch("/api/competitor/dominan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cabang: s.cabang, kategori: s.kategori, vendor: s.vendor, status }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `gagal (HTTP ${res.status})`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Kompetitor dominan per wilayah</CardTitle>
        <p className="text-muted-foreground text-xs">
          Dari sebutan kompetitor di laporan kunjungan {hari} hari terakhir, per cabang × kategori produk (brand Wahana sendiri tidak dihitung).
          <b> Dugaan dominan</b> = minimal 5 sebutan dan satu vendor menguasai ≥60%. Yang dikonfirmasi HoD tampil di briefing faskes wilayah itu.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect label="Cabang" value={cabang} onChange={setCabang} options={opsiCabang} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={semua} onChange={(e) => setSemua(e.target.checked)} /> Tampilkan semua sel (bukan hanya dugaan)
          </label>
        </div>
        {err && <p className="text-destructive text-sm">{err}</p>}
        {tampil.length === 0 ? <p className="text-muted-foreground text-sm">Tidak ada dugaan dominan untuk filter ini.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="py-1.5 pr-3 font-medium">Cabang</th><th className="py-1.5 pr-3 font-medium">Kategori</th>
                <th className="py-1.5 pr-3 font-medium">Vendor teratas</th><th className="py-1.5 pr-3 text-right font-medium">Pangsa sebutan</th>
                <th className="py-1.5 pr-3 font-medium">Berikutnya</th><th className="py-1.5 pr-3 font-medium">Status</th>
                {bolehUbah && <th className="py-1.5 font-medium" />}
              </tr></thead>
              <tbody>
                {tampil.map((s) => {
                  const k = `${s.cabang}|${s.kategori}`;
                  return (
                    <tr key={k} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{s.cabang}</td>
                      <td className="py-1.5 pr-3">{s.kategori}</td>
                      <td className="py-1.5 pr-3 font-medium">{s.vendor}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{Math.round(s.pangsa * 100)}% <span className="text-muted-foreground">({s.sebutan}/{s.total})</span></td>
                      <td className="text-muted-foreground py-1.5 pr-3">{s.runner_up ? `${s.runner_up.vendor} (${s.runner_up.sebutan})` : "—"}</td>
                      <td className="py-1.5 pr-3">
                        {s.status
                          ? <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[s.status])}>{s.status}{s.oleh ? ` · ${s.oleh}` : ""}</span>
                          : s.dugaan ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">dugaan</span>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      {bolehUbah && (
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {s.status ? (
                            <Button size="sm" variant="ghost" disabled={busy === k} onClick={() => tetapkan(s, "hapus")}>Batalkan penilaian</Button>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" disabled={busy === k} onClick={() => tetapkan(s, "dikonfirmasi")}>Konfirmasi</Button>{" "}
                              <Button size="sm" variant="ghost" disabled={busy === k} onClick={() => tetapkan(s, "ditolak")}>Tolak</Button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
