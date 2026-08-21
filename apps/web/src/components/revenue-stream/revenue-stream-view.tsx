"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRupiah } from "@/lib/pricelist";

export interface StreamRow {
  lineId: string;
  lini: string;
  kategori: string;
  revenue: number;
  share: number;
  baris: number;
  customers: number;
}

export interface StreamPayload {
  from: string;
  to: string;
  streams: StreamRow[];
  ringkasan: {
    revenueTerklasifikasi: number;
    revenueSemuaBarisItem: number;
    cakupanNilaiPct: number | null;
    tanpaKlasifikasi: { revenue: number; baris: number };
    nettoInvoice: number;
    selisihThdNettoInvoice: number;
  };
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** 8 bulan terakhir dihitung dari `akhir` (YYYY-MM-DD) — bukan dari waktu klien,
 *  supaya daftar periode tak bergeser saat tab dibuka lewat tengah malam. */
function opsiPeriode(akhir: string): { value: string; label: string }[] {
  const [y, m] = akhir.slice(0, 7).split("-").map(Number);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ value: val, label: `${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}

const pct = (v: number): string => `${v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

export function RevenueStreamView({ data, periode }: { data: StreamPayload | null; periode: string }) {
  const router = useRouter();

  if (!data) {
    return <EmptyState title="Data tak tersedia" description="Backend tidak merespons. Coba muat ulang." />;
  }

  const r = data.ringkasan;
  const cakupan = r.cakupanNilaiPct;
  // Di bawah 90% laporan belum layak dipakai menilai portofolio — bukan sekadar
  // "kurang lengkap", karena ember tanpa klasifikasi bisa lebih besar dari lini
  // mana pun (Agustus 2026: Rp 480 jt vs Hematology Rp 280 jt).
  const cakupanRendah = cakupan != null && cakupan < 90;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="periode" className="text-sm font-medium">Periode</label>
        <select
          id="periode"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={periode}
          onChange={(e) => router.push(`/revenue-stream?periode=${e.target.value}`)}
        >
          {opsiPeriode(data.to).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-muted-foreground text-sm">{data.from} → {data.to}</span>
      </div>

      {cakupanRendah ? (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-base">
              Baru {pct(cakupan)} nilai yang terklasifikasi
            </CardTitle>
            <CardDescription>
              {formatRupiah(r.tanpaKlasifikasi.revenue)} dari {r.tanpaKlasifikasi.baris} baris faktur
              belum terpetakan ke lini mana pun, karena produknya belum terdaftar di pricebook atau
              belum ditautkan ke item Accurate. Angka per lini di bawah <strong>bukan</strong> pembagian
              seluruh revenue — porsi yang tak terklasifikasi tidak ikut dibagi.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Revenue terklasifikasi</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(r.revenueTerklasifikasi)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            dari {formatRupiah(r.revenueSemuaBarisItem)} total baris faktur
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tanpa klasifikasi</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(r.tanpaKlasifikasi.revenue)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {r.tanpaKlasifikasi.baris} baris faktur
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Netto invoice (Sales Analytics)</CardDescription>
            <CardTitle className="text-2xl">{formatRupiah(r.nettoInvoice)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-xs">
            {/* Selisih ini WAJIB terlihat: tanpa penjelasan, dua menu terbaca saling
                bertentangan untuk periode yang sama. */}
            selisih {formatRupiah(Math.abs(r.selisihThdNettoInvoice))} dari jumlah baris faktur —
            diskon/biaya level invoice tak punya baris item
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue per lini produk</CardTitle>
          <CardDescription>
            Porsi dihitung terhadap revenue terklasifikasi, bukan terhadap total faktur.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.streams.length === 0 ? (
            <EmptyState title="Belum ada data" description="Tidak ada faktur terklasifikasi pada periode ini." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lini</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Porsi</TableHead>
                  <TableHead className="text-right">Baris</TableHead>
                  <TableHead className="text-right">Customer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.streams.map((s) => (
                  <TableRow key={`${s.kategori}-${s.lineId}-${s.lini}`}>
                    <TableCell className="font-medium">{s.lini}</TableCell>
                    <TableCell className="text-muted-foreground">{s.kategori}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(s.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(s.share)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.baris}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.customers}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
