"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

import { bulan, kirim, rp, tgl, type OpsProyek } from "./types";

// Rencana = patokan → warna netral putus-putus; aktual = pengukuran → warna seri.
const cfg = {
  rencana: { label: "Rencana", color: "var(--muted-foreground)" },
  aktual: { label: "Aktual", color: "var(--chart-1)" },
} satisfies ChartConfig;

const kelola = (slug: string, id: number) => `/proyek-hd/data/${slug}?proyek=${id}`;

function Tautan({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-primary text-sm font-semibold">{children}</Link>;
}

function Bar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{pct == null ? "—" : `${pct}%`}</span></div>
      <div className="bg-primary/15 h-2 overflow-hidden rounded-full"><div className="bg-primary h-2" style={{ width: `${pct ?? 0}%` }} /></div>
    </div>
  );
}

function Tanda({ ok }: { ok: boolean }) {
  return (
    <span aria-label={ok ? "sudah" : "belum"} className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded text-xs font-black",
      ok ? "bg-primary text-primary-foreground" : "border-2")}>{ok ? "✓" : ""}</span>
  );
}

const angka = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

// Panel data operasional di halaman detail proyek. `pernefri` = sudah ada catatan di tahap 2.
export function OpsPanel({ proyekId, pernefri }: { proyekId: number; pernefri: boolean }) {
  const [d, setD] = useState<OpsProyek | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let batal = false;
    kirim<OpsProyek>(`/api/proyek-hd/${proyekId}/ops`).then((r) => { if (!batal) setD(r); }).catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [proyekId]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat data operasional…</p>;
  const k = d.konstruksi;
  const seri = d.kurva.map((x) => ({ minggu: `M${x.minggu_ke}`, rencana: angka(x.pct_rencana), aktual: angka(x.pct_aktual) }));

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Konstruksi{k?.kontraktor ? ` · ${String(k.kontraktor)}` : ""}</CardTitle>
          <div className="flex gap-3"><Tautan href={kelola("konstruksi", proyekId)}>Ubah</Tautan><Tautan href={kelola("kurva-s", proyekId)}>Kurva S</Tautan></div>
        </CardHeader>
        <CardContent className="space-y-3">
          {seri.length >= 2 ? (
            <ChartContainer config={cfg} className="aspect-auto h-[180px] w-full">
              <LineChart data={seri} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="minggu" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={32} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="rencana" stroke="var(--color-rencana)" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="aktual" stroke="var(--color-aktual)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ChartContainer>
          ) : (
            <div className="space-y-2">
              <Bar label="Rencana (kumulatif)" pct={angka(k?.pct_rencana)} />
              <Bar label="Aktual (kumulatif)" pct={angka(k?.pct_aktual)} />
              <p className="text-muted-foreground text-xs">Grafik kurva S muncul setelah minimal 2 minggu diisi.</p>
            </div>
          )}
          <div className="space-y-1 border-t pt-3 text-sm">
            {k ? (
              <>
                <div>Dibayar: <strong>{angka(k.dibayar) ? rp(angka(k.dibayar)) : "belum dibayar"}</strong></div>
                <div>Mulai {tgl(k.mulai as string | null)} · target selesai <strong>{bulan(k.target_selesai as string | null)}</strong></div>
                {k.lingkup ? <p className="text-muted-foreground">{String(k.lingkup)}</p> : null}
              </>
            ) : <p className="text-muted-foreground">Belum ada data konstruksi.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Gate SOP</CardTitle><Tautan href={kelola("konstruksi", proyekId)}>Ubah</Tautan>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><Tanda ok={pernefri} />Tim ikut asistensi PERNEFRI</li>
            {d.gate.map((g, i) => (
              <li key={i} className="flex items-center gap-2"><Tanda ok={g.ok} /><span><span className="text-muted-foreground text-xs font-bold">{g.kode}</span> {g.label}</span></li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-xs">Dibaca dari data Konstruksi & RO. G1–G3 wajib lengkap sebelum tukang masuk.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Mesin & RO</CardTitle>
          <div className="flex gap-3"><Tautan href={kelola("ro", proyekId)}>RO</Tautan><Tautan href={kelola("mesin", proyekId)}>Mesin</Tautan></div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {d.ro ? (
            <p>
              RO {d.ro.kapasitas_gdp ? `${String(d.ro.kapasitas_gdp)} GDP` : ""} · {String(d.ro.status_ro || "status belum diisi")}
              {d.ro.vendor ? ` · ${String(d.ro.vendor)}` : ""}{d.ro.uji_air ? " · uji air OK" : ""}
              {d.ro.jadwal_masuk ? ` · masuk ${tgl(String(d.ro.jadwal_masuk))}` : ""}
            </p>
          ) : <p className="text-muted-foreground">Belum ada data RO.</p>}
          {d.mesin.map((m) => (
            <p key={m.id}>{String(m.jumlah_unit ?? "")} unit {String(m.merk ?? "")} {m.dari ? `dari ${String(m.dari)}` : ""} {m.ke ? `ke ${String(m.ke)}` : ""} · {String(m.status || "—")}</p>
          ))}
          {!d.mesin.length && <p className="text-muted-foreground">Belum ada relokasi / cek mesin.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Isu terbuka</CardTitle><Tautan href={kelola("isu", proyekId)}>Kelola</Tautan>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {d.isu_terbuka.length === 0 && <p className="text-muted-foreground">Tidak ada isu terbuka.</p>}
          {d.isu_terbuka.map((i) => (
            <div key={i.id} className="border-b pb-2 last:border-b-0">
              <div>{String(i.isu)}</div>
              <div className="text-muted-foreground text-xs">{[i.tindakan ? String(i.tindakan) : null, i.pic_nama, String(i.status)].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 border-t pt-2">
            <Tautan href={kelola("keuangan", proyekId)}>Keuangan</Tautan>
            <Tautan href={kelola("permintaan", proyekId)}>Permintaan RS</Tautan>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
