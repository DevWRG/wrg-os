"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JenisKejadian, KalenderKlinikHasil, KejadianKlinik } from "./types";

const HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const LABEL: Record<JenisKejadian, string> = { jatuh_tempo: "Jatuh tempo", bayar: "Dibayar" };
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

const bulanIni = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);

function geser(bulan: string, delta: number): string {
  const [y, m] = bulan.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** Sel grid bulan, Senin pertama; null = sel kosong. */
function selBulan(bulan: string): (string | null)[] {
  const [y, m] = bulan.split("-").map(Number) as [number, number];
  const hariDalamBulan = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const awal = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return [
    ...Array<null>(awal).fill(null),
    ...Array.from({ length: hariDalamBulan }, (_, i) => `${bulan}-${String(i + 1).padStart(2, "0")}`),
  ];
}

type Hasil = { bulan: string; data: KalenderKlinikHasil | null; galat: string | null };

export function KalenderView() {
  const [bulan, setBulan] = useState(bulanIni);
  // Hasil dikunci per bulan: hasil bulan lain dianggap "memuat", tanpa setState sinkron di effect.
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [dipilih, setDipilih] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const r = await fetch(`/api/tukar-faktur/kalender?bulan=${encodeURIComponent(bulan)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 403 ? "Tidak punya akses" : r.status === 503 ? "Migrasi belum diterapkan" : `Gagal memuat (${r.status})`);
        const data = (await r.json()) as KalenderKlinikHasil;
        if (!batal) setHasil({ bulan, data, galat: null });
      } catch (e) {
        if (!batal) setHasil({ bulan, data: null, galat: e instanceof Error ? e.message : "Gagal memuat" });
      }
    })();
    return () => { batal = true; };
  }, [bulan]);

  const pindah = (b: string) => { setBulan(b); setDipilih(null); };
  const saatIni = hasil?.bulan === bulan ? hasil : null;
  const data = saatIni?.data ?? null;
  const galat = saatIni?.galat ?? null;

  const perHari = new Map<string, KejadianKlinik[]>();
  for (const e of data?.events ?? []) perHari.set(e.tanggal, [...(perHari.get(e.tanggal) ?? []), e]);
  const detail = dipilih ? perHari.get(dipilih) ?? [] : [];
  const tombol = "rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-accent";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" className={tombol} onClick={() => pindah(geser(bulan, -1))}>←</button>
        <span className="min-w-28 text-center text-sm font-semibold tabular-nums">{bulan}</span>
        <button type="button" className={tombol} onClick={() => pindah(geser(bulan, 1))}>→</button>
        <button type="button" className={tombol} onClick={() => pindah(bulanIni())}>Bulan ini</button>
        {data && <span className="ml-auto text-xs text-muted-foreground">{data.total} kejadian</span>}
      </div>

      {galat && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{galat}</div>}
      {data?.terpotong && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Kejadian terlalu banyak; sebagian tidak tampil.
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 text-xs">
        {HARI.map((h) => <div key={h} className="px-1 py-1 font-medium text-muted-foreground">{h}</div>)}
        {selBulan(bulan).map((tgl, i) => {
          if (!tgl) return <div key={`k${i}`} />;
          const ev = perHari.get(tgl) ?? [];
          const jt = ev.filter((e) => e.jenis === "jatuh_tempo").length;
          const by = ev.length - jt;
          return (
            <button
              key={tgl} type="button" disabled={ev.length === 0} onClick={() => setDipilih(dipilih === tgl ? null : tgl)}
              className={cn("min-h-16 rounded-md border p-1 text-left", ev.length ? "bg-card hover:bg-accent" : "opacity-60",
                dipilih === tgl && "border-primary")}
            >
              <div className="tabular-nums">{Number(tgl.slice(8))}</div>
              {jt > 0 && <div className="text-destructive">{jt} jatuh tempo</div>}
              {by > 0 && <div className="text-muted-foreground">{by} dibayar</div>}
            </button>
          );
        })}
      </div>

      {!data && !galat && <p className="text-sm text-muted-foreground">Memuat…</p>}
      {data && data.total === 0 && <p className="text-sm text-muted-foreground">Tidak ada jatuh tempo atau pembayaran klinik pada bulan ini.</p>}

      {dipilih && (
        <section className="space-y-2 rounded-lg border p-3">
          <h2 className="text-sm font-semibold">{dipilih}</h2>
          {detail.map((e) => (
            <div key={`${e.jenis}:${e.nomor}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={e.jenis === "jatuh_tempo" ? "destructive" : "outline"}>{LABEL[e.jenis]}</Badge>
              <span className="font-medium">{e.customer}</span>
              <span className="text-muted-foreground">{e.nomor}</span>
              <span className="tabular-nums">{rp(e.nominal)}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {e.pic_nama ? `PIC: ${e.pic_nama}${e.pic_hp ? ` · ${e.pic_hp}` : ""}` : "PIC belum diisi"}
              </span>
            </div>
          ))}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Jatuh tempo &amp; pembayaran faktur customer klinik (dari Accurate). Jam buka dan hari tanda tangan tidak
        tercatat di Accurate sehingga belum tampil; PIC diambil dari kontak utama di Accounts 360 bila sudah diisi.
        Faktur lama bisa tampak belum lunas karena data Accurate hanya disegarkan untuk faktur 7 hari terakhir.
      </p>
    </div>
  );
}
