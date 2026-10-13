"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import { KampanyeFormDialog, type OpsiKampanye } from "./kampanye-form";
import { BilahProgres, LabelPacing } from "./progres";
import { STATUS_CLS, angka, periode, persen, rp, type KampanyeList, type StatusKampanye } from "./types";

const URUT: StatusKampanye[] = ["berjalan", "akan datang", "selesai", "dibatalkan"];

// F74 — daftar kampanye. Angka sudah di-scope server (AM = dirinya, HoD = timnya).
export function KampanyeListView({ data, opsi, bolehTambah }: { data: KampanyeList[]; opsi: OpsiKampanye; bolehTambah: boolean }) {
  const [status, setStatus] = useState("");
  const [buat, setBuat] = useState({ open: false, n: 0 });

  const tampil = useMemo(() => data
    .filter((k) => (status ? k.status === status : k.status !== "dibatalkan"))
    .sort((a, b) => URUT.indexOf(a.status) - URUT.indexOf(b.status) || b.tanggal_selesai.localeCompare(a.tanggal_selesai)), [data, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect label="Status" value={status} onChange={setStatus} semua="Semua kecuali dibatalkan"
            options={URUT.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
          <p className="text-muted-foreground text-sm">AM bisa cek progres lewat WhatsApp: <code>#KAMPANYE</code>.</p>
        </div>
        {bolehTambah && <Button size="sm" onClick={() => setBuat({ open: true, n: buat.n + 1 })}>Buat kampanye</Button>}
      </div>

      {tampil.length === 0 ? (
        <div className="bg-card text-muted-foreground rounded-lg border p-8 text-center text-sm">
          {data.length === 0 ? "Belum ada kampanye." : "Tidak ada kampanye dengan status ini."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {tampil.map((k) => {
            const r = k.ringkasan;
            return (
              <Link key={k.id} href={`/kampanye/${k.id}`}
                className="bg-card block space-y-3 rounded-lg border p-4 shadow-[var(--shadow-card)] transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{k.nama}</div>
                    <div className="text-muted-foreground text-xs">{k.kode} · {periode(k)}</div>
                  </div>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[k.status])}>{k.status}</span>
                </div>
                <div className="text-muted-foreground line-clamp-1 text-xs">
                  {[...k.brands, ...(k.items.length ? [`+${k.items.length} item`] : [])].join(" · ")}
                </div>
                {k.status !== "dibatalkan" && (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <div><span className="text-lg font-bold tabular-nums">{rp(r.netto)}</span>
                        <span className="text-muted-foreground text-sm"> / {r.target_rp > 0 ? rp(r.target_rp) : "tanpa target"}</span></div>
                      <span className="text-sm font-semibold tabular-nums">{persen(r.pacing.capai_pct)}</span>
                    </div>
                    <BilahProgres pacing={r.pacing} />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <LabelPacing pacing={r.pacing} />
                      <span className="text-muted-foreground">
                        {k.status === "berjalan" ? `hari ${r.pacing.hari_ke}/${r.pacing.hari_total} · ` : ""}{r.faktur} faktur
                        {k.satuan_qty ? ` · ${angka(r.qty)}${r.target_qty != null ? `/${angka(r.target_qty)}` : ""} ${k.satuan_qty}` : ""}
                      </span>
                    </div>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {bolehTambah && <KampanyeFormDialog key={buat.n} open={buat.open} onClose={() => setBuat({ ...buat, open: false })} opsi={opsi} />}
    </div>
  );
}
