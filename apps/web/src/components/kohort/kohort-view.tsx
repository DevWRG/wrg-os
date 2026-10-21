"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/pricelist";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard } from "@/components/ui/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Tipe di-mirror dari apps/api/src/repo/kohort.ts.
interface Kohort {
  kuartal: 1 | 2 | 3 | 4;
  label: string;
  ukuran: number;
  lengkap: boolean;
  aktif: (number | null)[];
  berjalan: number | null;
  persen: (number | null)[];
}
interface Retensi {
  tahun: number;
  data_mulai: string | null;
  kohort: Kohort[];
}
interface SelLead {
  total: number;
  baru: number;
  dihubungi: number;
  dikonversi: number;
  ditolak: number;
  nilai: number;
}
interface LeadSource {
  tahun: number;
  data_mulai: string | null;
  sumber: { key: string; label: string; kuartal: SelLead[]; total: SelLead }[];
  per_hod: { hod_key: string; semester: SelLead[]; total: SelLead }[];
}

const STATUS = ["baru", "dihubungi", "dikonversi", "ditolak"] as const;
const STATUS_LABEL: Record<(typeof STATUS)[number], string> = {
  baru: "Baru", dihubungi: "Dihubungi", dikonversi: "Dikonversi", ditolak: "Ditolak",
};

type Tab = "retensi" | "lead-source";
const TABS: { key: Tab; label: string }[] = [
  { key: "retensi", label: "Retensi Customer" },
  { key: "lead-source", label: "Lead Source" },
];

const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(0)}%` : "—");
const tglID = (iso: string) => iso.split("-").reverse().join("/");

// Hasil disimpan bersama kuncinya; "memuat" = hasil terakhir bukan untuk (tab, tahun) terpilih.
function useKohort<T>(tab: Tab, tahun: number) {
  const kunci = `${tab}:${tahun}`;
  const [hasil, setHasil] = useState<{ kunci: string; data: T | null; err: string | null } | null>(null);
  useEffect(() => {
    let batal = false;
    (async () => {
      let data: T | null = null;
      let err: string | null = null;
      try {
        const r = await fetch(`/api/kohort/${tab}?tahun=${tahun}`, { cache: "no-store" });
        if (r.ok) data = (await r.json()) as T;
        else err = r.status === 403 ? "Tidak punya akses." : `Gagal memuat (${r.status}).`;
      } catch {
        err = "Server tidak terjangkau.";
      }
      if (!batal) setHasil({ kunci, data, err });
    })();
    return () => {
      batal = true;
    };
  }, [tab, tahun, kunci]);
  const loading = hasil?.kunci !== kunci;
  return { loading, data: loading ? null : (hasil?.data ?? null), err: loading ? null : (hasil?.err ?? null) };
}

const WARNA = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

function RetensiTab({ tahun }: { tahun: number }) {
  const { loading, data, err } = useKohort<Retensi>("retensi", tahun);
  if (loading) return <LoadingCard />;
  if (err || !data) return <EmptyState title="Tidak bisa menampilkan data" description={err ?? "Data kosong."} />;

  const config = Object.fromEntries(
    data.kohort.map((k, i) => [`q${k.kuartal}`, { label: k.label, color: WARNA[i] }]),
  ) satisfies ChartConfig;
  const titik = Array.from({ length: 5 }, (_, o) => ({
    offset: `+${o} kuartal`,
    // Kuartal berjalan = data parsial → tak digambar di kurva (terbaca seperti churn), tetap ada di tabel.
    ...Object.fromEntries(data.kohort.map((k) => [`q${k.kuartal}`, k.berjalan === o ? null : k.persen[o]])),
  }));
  const adaData = data.kohort.some((k) => k.ukuran > 0);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Kohort = kuartal faktur pertama customer di mirror Accurate. Customer dihitung <em>aktif</em> di sebuah kuartal bila punya ≥1 faktur
        bernilai positif. Kuartal +k = porsi kohort yang masih bertransaksi k kuartal kemudian.
        {data.data_mulai ? ` Data faktur mirror mulai ${tglID(data.data_mulai)}.` : ""}
      </p>
      {!adaData ? (
        <EmptyState title={`Belum ada kohort ${tahun}`} description="Tidak ada customer dengan faktur pertama di tahun ini pada data mirror." />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kurva retensi per kohort {tahun}</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={config} className="aspect-auto h-[280px] w-full">
                <LineChart data={titik} margin={{ left: 4, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="offset" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} width={44} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {data.kohort.map((k) => (
                    <Line key={k.kuartal} dataKey={`q${k.kuartal}`} stroke={`var(--color-q${k.kuartal})`} strokeWidth={2} dot connectNulls={false} />
                  ))}
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kohort</TableHead>
                    <TableHead className="text-right">Customer baru</TableHead>
                    {[0, 1, 2, 3, 4].map((o) => (
                      <TableHead key={o} className="text-right">+{o}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.kohort.map((k) => (
                    <TableRow key={k.kuartal}>
                      <TableCell className="font-medium">
                        {k.label}
                        {!k.lengkap && k.ukuran > 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs" title="Kuartal pertama data mirror: memuat customer lama yang fakturnya terekam lebih awal di Accurate">
                            *
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{k.ukuran.toLocaleString("id-ID")}</TableCell>
                      {k.persen.map((p, o) => (
                        <TableCell key={o} className={cn("text-right tabular-nums", k.berjalan === o && "italic")}>
                          {p == null ? <span className="text-muted-foreground">—</span> : `${p.toFixed(1)}%`}
                          {k.aktif[o] != null ? <span className="text-muted-foreground ml-1 text-xs">({k.aktif[o]})</span> : null}
                          {k.berjalan === o && o > 0 ? (
                            <span className="text-muted-foreground ml-1 text-xs" title="Kuartal ini belum selesai — angka masih parsial">
                              †
                            </span>
                          ) : null}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {data.kohort.some((k) => k.berjalan !== null && k.berjalan > 0) ? (
            <p className="text-muted-foreground text-xs">
              † Kuartal berjalan belum selesai: angkanya parsial (bukan churn) dan tidak digambar di kurva.
            </p>
          ) : null}
          {data.kohort.some((k) => !k.lengkap && k.ukuran > 0) ? (
            <p className="text-muted-foreground text-xs">
              * Kohort di kuartal pertama data mirror tidak murni “customer baru” — memuat customer lama yang fakturnya baru terekam di sini.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function LeadSourceTab({ tahun }: { tahun: number }) {
  const { loading, data, err } = useKohort<LeadSource>("lead-source", tahun);
  const [filter, setFilter] = useState<string>("semua");
  if (loading) return <LoadingCard />;
  if (err || !data) return <EmptyState title="Tidak bisa menampilkan data" description={err ?? "Data kosong."} />;

  const total = data.sumber.reduce((s, x) => s + x.total.total, 0);
  const terpilih = data.sumber.filter((s) => filter === "semua" || s.key === filter);
  const status = (q: number, st: (typeof STATUS)[number]) => terpilih.reduce((s, x) => s + x.kuartal[q][st], 0);
  const totalQ = (q: number) => terpilih.reduce((s, x) => s + x.kuartal[q].total, 0);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Lead per kuartal pembuatan, dikelompokkan ke lima sumber Direktur (Tender = LPSE, Referensi customer = referral, Trade show = pameran,
        Cold call = telepon; WA/web/lainnya masuk “Lainnya”). <strong>Vendor lead belum punya nilai sumber di form lead</strong>, jadi tampil 0.
        {data.data_mulai
          ? ` Data lead baru terkumpul sejak ${tglID(data.data_mulai)} (F65) — kuartal sebelumnya kosong, bukan berarti tak ada lead.`
          : " Belum ada lead tercatat."}
      </p>
      {total === 0 ? (
        <EmptyState title={`Belum ada lead ${tahun}`} description="Tidak ada lead dibuat pada tahun ini." />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lead per sumber × kuartal {tahun}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sumber</TableHead>
                    {[1, 2, 3, 4].map((q) => (
                      <TableHead key={q} className="text-right">Q{q}</TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Konversi</TableHead>
                    <TableHead className="text-right">Nilai estimasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sumber.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell className="font-medium">{s.label}</TableCell>
                      {s.kuartal.map((c, q) => (
                        <TableCell key={q} className="text-right tabular-nums">
                          {c.total}
                          {c.total > 0 ? <span className="text-muted-foreground ml-1 text-xs">({pct(c.dikonversi, c.total)})</span> : null}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{s.total.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(s.total.dikonversi, s.total.total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.total.nilai > 0 ? formatRupiah(s.total.nilai) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">Status per kuartal</CardTitle>
              <div className="flex flex-wrap gap-1">
                {[{ key: "semua", label: "Semua sumber" }, ...data.sumber.map((s) => ({ key: s.key, label: s.label }))].map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setFilter(o.key)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs",
                      filter === o.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    {[1, 2, 3, 4].map((q) => (
                      <TableHead key={q} className="text-right">Q{q}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STATUS.map((st) => (
                    <TableRow key={st}>
                      <TableCell className="font-medium">{STATUS_LABEL[st]}</TableCell>
                      {[0, 1, 2, 3].map((q) => (
                        <TableCell key={q} className="text-right tabular-nums">{status(q, st)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium">Total</TableCell>
                    {[0, 1, 2, 3].map((q) => (
                      <TableCell key={q} className="text-right font-medium tabular-nums">{totalQ(q)}</TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">Konversi</TableCell>
                    {[0, 1, 2, 3].map((q) => (
                      <TableCell key={q} className="text-muted-foreground text-right tabular-nums">{pct(status(q, "dikonversi"), totalQ(q))}</TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Per HoD per semester (bahan menilai effort / NPK)</CardTitle>
              <p className="text-muted-foreground text-xs">
                S1 = Q1–Q2, S2 = Q3–Q4. Hanya rekap lead &amp; konversi; <strong>tidak mengubah skor NPK</strong>.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>HoD</TableHead>
                    <TableHead className="text-right">S1 lead</TableHead>
                    <TableHead className="text-right">S1 konversi</TableHead>
                    <TableHead className="text-right">S2 lead</TableHead>
                    <TableHead className="text-right">S2 konversi</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.per_hod.map((h) => (
                    <TableRow key={h.hod_key}>
                      <TableCell className="font-medium">{h.hod_key}</TableCell>
                      {h.semester.map((s, i) => (
                        <FragmentCells key={i} total={s.total} konv={pct(s.dikonversi, s.total)} />
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{h.total.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function FragmentCells({ total, konv }: { total: number; konv: string }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{total}</TableCell>
      <TableCell className="text-right tabular-nums">{konv}</TableCell>
    </>
  );
}

export function KohortView() {
  const [tab, setTab] = useState<Tab>("retensi");
  // Tahun berjalan menurut WIB, dihitung sekali di klien (halaman server tak boleh memanggil Date.now).
  const [tahunIni] = useState(() => Number(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 4)));
  const [tahun, setTahun] = useState(tahunIni);
  const tahunOpsi = [tahunIni, tahunIni - 1, tahunIni - 2];

  return (
    <div className="space-y-4">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {tahunOpsi.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setTahun(y)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm",
                tahun === y ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
      {tab === "retensi" ? <RetensiTab tahun={tahun} /> : <LeadSourceTab tahun={tahun} />}
    </div>
  );
}
