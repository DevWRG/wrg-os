"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Insentif Saya — SELF-ONLY untuk semua peran, termasuk Direktur (PRD §E.3).
// Identitas datang dari sesi lewat BFF (x-user-id) → backend /insentif/self.
// Halaman ini TIDAK pernah menerima am_id dari mana pun, termasuk query string.

const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number | null | undefined) => rp.format(n || 0);
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

const MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (ym: string) => {
  const [y, m] = (ym ?? "").split("-");
  return `${MONTH_ID[Number(m) - 1] ?? m} ${y ?? ""}`;
};

const NCR_LABEL: Record<string, string> = {
  existing: "—",
  newMurni: "Customer baru",
  reaktivasi: "Reaktivasi",
};
const LEAD_LABEL: Record<string, string> = {
  A: "Prospek sendiri",
  B: "Lead manajemen",
  C: "Akun HO",
};

interface Ringkas {
  am_id: string; nama: string; panggilan: string | null; periode: string; tier_ut: string;
  total_insentif_am: number; total_insentif_ho: number;
  dibayar: number; retention_pool: number; cap_bulanan: number;
  status: string; transaksi: number;
}
interface Trx {
  invoice_no: string; tanggal: string; revenue: number;
  gp_actual_pct: number | null; aging_days: number | null;
  ncr_type: string; lead_type: string;
  mr_pct: number; ncr_pct: number; cf: number; pengali: number;
  insentif_am: number; insentif_ho: number;
  computed_from: { aging_diketahui?: boolean; hpp_lengkap?: boolean } | null;
}
interface Resp {
  linked: boolean; message?: string; periode?: string;
  ringkas?: Ringkas | null; transaksi?: Trx[];
}

function periodeSekarang() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function InsentifSaya() {
  const [periode, setPeriode] = useState(periodeSekarang());
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/insentif/self?periode=${periode}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (alive) setData(json as Resp);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [periode]);

  // Pilihan periode: 12 bulan terakhir, cukup untuk kebutuhan baca-slip.
  const opsiPeriode = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  if (loading) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (err) return <p className="text-sm text-destructive">Gagal memuat: {err}</p>;

  if (data && data.linked === false) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {data.message ?? "Akun belum tertaut ke data karyawan."}
          <div className="mt-2 text-xs">Hubungi admin untuk menautkan akun Anda ke data AM.</div>
        </CardContent>
      </Card>
    );
  }

  const r = data?.ringkas ?? null;
  const trx = data?.transaksi ?? [];

  // Dua kondisi "tidak diketahui" dari lapisan hitung. Ditampilkan apa adanya supaya AM
  // tahu kenapa angkanya begitu, bukan disembunyikan lalu jadi pertanyaan ke Finance.
  const tanpaAging = trx.filter((t) => t.computed_from?.aging_diketahui === false).length;
  const tanpaHpp = trx.filter((t) => t.computed_from?.hpp_lengkap === false).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="periode" className="text-sm text-muted-foreground">Periode</label>
        <select
          id="periode"
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          className="h-9 rounded-md border bg-white px-3 text-sm"
        >
          {opsiPeriode.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
        </select>
      </div>

      {!r ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Belum ada insentif terhitung untuk {monthLabel(periode)}.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Insentif bulan ini</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtRp(r.total_insentif_am)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{r.transaksi} transaksi lunas</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Dibayarkan</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtRp(r.dibayar)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Batas bulanan {fmtRp(r.cap_bulanan)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Ditahan (akhir tahun)</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{fmtRp(r.retention_pool)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {r.retention_pool > 0 ? "Kelebihan di atas batas bulanan" : "Tidak ada kelebihan"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold capitalize">{r.status.replace(/_/g, " ")}</div>
                <div className="mt-1 text-xs text-muted-foreground">Tier {r.tier_ut}</div>
              </CardContent>
            </Card>
          </div>

          {(tanpaHpp > 0 || tanpaAging > 0) && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="py-3 text-xs text-amber-900">
                <div className="font-medium">Sebagian angka memakai nilai netral:</div>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {tanpaHpp > 0 && (
                    <li>
                      {tanpaHpp} transaksi belum punya HPP lengkap di price book → bonus margin dihitung 0.
                    </li>
                  )}
                  {tanpaAging > 0 && (
                    <li>
                      {tanpaAging} transaksi tidak diketahui umur penagihannya → faktor penagihan dianggap netral (1,00).
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Rincian per transaksi</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 text-right font-medium">Nilai</th>
                    <th className="py-2 pr-3 text-right font-medium">Margin</th>
                    <th className="py-2 pr-3 text-right font-medium">Bonus margin</th>
                    <th className="py-2 pr-3 text-right font-medium">Penagihan</th>
                    <th className="py-2 pr-3 font-medium">Customer baru</th>
                    <th className="py-2 pr-3 font-medium">Sumber lead</th>
                    <th className="py-2 pl-3 text-right font-medium">Insentif</th>
                  </tr>
                </thead>
                <tbody>
                  {trx.map((t) => (
                    <tr key={t.invoice_no} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{t.invoice_no}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{t.tanggal}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtRp(t.revenue)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(t.gp_actual_pct)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.mr_pct > 0 ? `+${t.mr_pct}%` : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {t.cf.toFixed(2)}×
                        {t.aging_days != null && (
                          <span className="ml-1 text-xs text-muted-foreground">({t.aging_days} hr)</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">{NCR_LABEL[t.ncr_type] ?? t.ncr_type}</td>
                      <td className="py-2 pr-3 text-xs">
                        {t.lead_type === "A" ? (
                          <span className="text-muted-foreground">{LEAD_LABEL.A}</span>
                        ) : (
                          <Badge variant="secondary">{LEAD_LABEL[t.lead_type] ?? t.lead_type}</Badge>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right font-medium tabular-nums">{fmtRp(t.insentif_am)}</td>
                    </tr>
                  ))}
                  {trx.length === 0 && (
                    <tr><td colSpan={9} className="py-6 text-center text-sm text-muted-foreground">Belum ada transaksi lunas pada periode ini.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
