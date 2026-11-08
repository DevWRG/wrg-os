"use client";

import { useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// F92 — tabel satu laporan Report Library dengan paginasi SERVER: tiap ganti halaman
// meminta /api/report-library/<key>?hal=&per=, jadi `total` selalu jumlah baris
// sebenarnya (bukan panjang potongan). Halaman pertama datang dari render server.
// Footer meniru DataTable: "Baris/hal", "Hal x/y", Prev/Next.

const PER_HALAMAN = [10, 25, 50, 100];

export function TabelLaporan({
  laporanKey,
  header,
  barisAwal,
  total,
}: {
  laporanKey: string;
  header: string[];
  barisAwal: string[][];
  total: number;
}) {
  const [baris, setBaris] = useState(barisAwal);
  const [hal, setHal] = useState(0);
  const [per, setPer] = useState(PER_HALAMAN[0]);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const jumlahHal = Math.max(1, Math.ceil(total / per));
  const muat = async (h: number, p: number) => {
    setSibuk(true);
    try {
      const r = await fetch(`/api/report-library/${laporanKey}?hal=${h}&per=${p}`);
      const x = (await r.json().catch(() => ({}))) as { baris?: string[][]; hal?: number; per?: number; error?: string };
      if (!r.ok || !x.baris) throw new Error(x.error ?? `HTTP ${r.status}`);
      setBaris(x.baris); setHal(x.hal ?? h); setPer(x.per ?? p); setGalat(null);
    } catch (e) {
      setGalat(`Gagal memuat halaman: ${(e as Error).message}`);
    } finally {
      setSibuk(false);
    }
  };

  const dari = hal * per + 1;
  const sampai = Math.min(total, hal * per + baris.length);
  return (
    <>
      <div className="overflow-x-auto">
        <Table className={sibuk ? "opacity-60" : undefined}>
          <TableHeader>
            <TableRow>{header.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {baris.map((b, i) => (
              <TableRow key={hal * per + i}>{b.map((s, k) => <TableCell key={k} className="whitespace-nowrap">{s}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {galat && <p className="text-destructive text-xs">{galat}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground text-xs">
          {total > PER_HALAMAN[0] ? `${dari}–${sampai} dari ${total} baris · PDF memuat semuanya` : `${total} baris`}
        </span>
        {total > PER_HALAMAN[0] && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Baris/hal:</span>
              <select
                value={per}
                disabled={sibuk}
                onChange={(e) => void muat(0, Number(e.target.value))}
                className="h-7 rounded-md border border-input bg-transparent px-1.5 text-sm outline-none"
              >
                {PER_HALAMAN.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Hal {hal + 1}/{jumlahHal}</span>
              <button
                type="button"
                onClick={() => void muat(hal - 1, per)}
                disabled={sibuk || hal === 0}
                className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => void muat(hal + 1, per)}
                disabled={sibuk || hal >= jumlahHal - 1}
                className="rounded-md border px-2 py-1 text-xs disabled:opacity-40 hover:bg-muted"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
