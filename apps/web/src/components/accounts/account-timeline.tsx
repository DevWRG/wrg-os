"use client";

import { useState } from "react";
import { BadgeCheck, FileText, FlaskConical, MessageSquareText, Phone, Presentation, Route, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// F95 — timeline per account: #CALL/#NOTE (interaction_log) + aktivitas AM
// (activity_log) + perubahan tahap deal (spt_state_log) + faktur Accurate.
// Halaman pertama diambil di server (page.tsx, bareng data account); halaman
// berikutnya lewat kursor dari /api/accounts/:id/timeline. Filter jenis bekerja
// di atas baris yang sudah dimuat (bukan query ulang).

type Jenis = "call" | "note" | "aktivitas" | "deal" | "faktur" | "demo" | "trial" | "bayar";
export interface TimelineItem {
  jenis: Jenis; waktu: string; judul: string | null; isi: string | null; oleh: string | null; ref: string;
  nilai?: number; sisa?: number; status?: string | null;
}

type Item = TimelineItem;
export interface TimelinePage { items: TimelineItem[]; berikutnya: string | null }

// F131 — ringkasan "AR & pembayaran" (apps/api/src/repo/pembayaran.ts).
export interface StatBayar { faktur: number; median_hari: number | null; rata_hari: number | null; tepat_pct: number | null; rata_telat_hari: number | null }
export interface RingkasPembayaran {
  piutang: { sisa: number; faktur_terbuka: number; lewat_tempo: { faktur: number; nilai: number; terlama_hari: number } };
  bayar_12bln: StatBayar;
  bayar_sebelumnya: StatBayar;
}

const FILTER: { v: string; l: string; cocok: (i: Item) => boolean }[] = [
  { v: "semua", l: "Semua", cocok: () => true },
  { v: "interaksi", l: "Telepon & catatan", cocok: (i) => i.jenis === "call" || i.jenis === "note" },
  { v: "aktivitas", l: "Aktivitas AM", cocok: (i) => i.jenis === "aktivitas" },
  { v: "deal", l: "Deal", cocok: (i) => i.jenis === "deal" },
  { v: "demo", l: "Demo & trial", cocok: (i) => i.jenis === "demo" || i.jenis === "trial" },
  { v: "faktur", l: "Faktur", cocok: (i) => i.jenis === "faktur" },
  // F131: pelunasan + faktur yang masih bersisa tagihan.
  { v: "ar", l: "AR & pembayaran", cocok: (i) => i.jenis === "bayar" || (i.jenis === "faktur" && (i.sisa ?? 0) > 0) },
];

const GAYA: Record<Jenis, { label: string; Icon: typeof Phone; tone: string }> = {
  call: { label: "Telepon", Icon: Phone, tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300" },
  note: { label: "Catatan", Icon: MessageSquareText, tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  aktivitas: { label: "Aktivitas", Icon: Route, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  deal: { label: "Deal", Icon: Workflow, tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  faktur: { label: "Faktur", Icon: FileText, tone: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  demo: { label: "Demo", Icon: Presentation, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  trial: { label: "Trial", Icon: FlaskConical, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  bayar: { label: "Lunas", Icon: BadgeCheck, tone: "bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300" },
};

function Angka({ label, nilai, sub, tone }: { label: string; nilai: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-md border p-2.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tone ?? ""}`}>{nilai}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

function RingkasanAr({ r }: { r: RingkasPembayaran }) {
  const k = r.bayar_12bln;
  const d = r.bayar_sebelumnya;
  const l = r.piutang.lewat_tempo;
  const tren = k.median_hari != null && d.median_hari != null && k.faktur >= 3 && d.faktur >= 3
    ? (Math.abs(k.median_hari - d.median_hari) < 7 ? "stabil" : k.median_hari < d.median_hari ? "lebih cepat" : "lebih lambat")
    : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Angka label="Piutang" nilai={rp(r.piutang.sisa)} sub={`${r.piutang.faktur_terbuka} faktur terbuka`} />
        <Angka label="Lewat jatuh tempo" nilai={l.faktur ? rp(l.nilai) : "—"} tone={l.faktur ? "text-rose-700 dark:text-rose-400" : undefined}
          sub={l.faktur ? `${l.faktur} faktur · terlama ${l.terlama_hari} hari` : "tidak ada"} />
        <Angka label="Kecepatan bayar (12 bln)" nilai={k.median_hari != null ? `${k.median_hari} hari` : "—"}
          sub={k.faktur ? `median dari ${k.faktur} faktur lunas${tren ? ` · ${tren}` : ""}` : "belum ada pelunasan"} />
        <Angka label="Tepat waktu" nilai={k.tepat_pct != null ? `${k.tepat_pct}%` : "—"}
          sub={k.rata_telat_hari ? `yang telat rata-rata ${k.rata_telat_hari} hari` : undefined} />
      </div>
      <p className="text-muted-foreground text-xs">
        Tanggal bayar dari Accurate (tanggal pelunasan; untuk cicilan = cicilan terakhir). Tepat waktu = lunas paling lambat di tanggal jatuh tempo.
        {d.faktur ? ` 12 bulan sebelumnya: median ${d.median_hari} hari, ${d.tepat_pct ?? "—"}% tepat waktu.` : ""}
      </p>
    </div>
  );
}

const rp = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
// Aktivitas & faktur cuma bertanggal (jam 00:00 WIB dari backend) → tanpa jam.
const fmtWaktu = (iso: string, denganJam: boolean) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric",
    ...(denganJam ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));

export function AccountTimeline({ accountId, initial, pembayaran = null }: { accountId: string; initial: TimelinePage | null; pembayaran?: RingkasPembayaran | null }) {
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [kursor, setKursor] = useState<string | null>(initial?.berikutnya ?? null);
  const [muat, setMuat] = useState(false);
  const [err, setErr] = useState<string | null>(initial ? null : "Gagal memuat timeline.");
  const [filter, setFilter] = useState("semua");

  async function muatLagi(k: string) {
    setMuat(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ limit: "50", kursor: k });
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/timeline?${qs}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(d.error ?? `HTTP ${res.status}`));
      setItems((prev) => [...prev, ...(d.items as Item[])]);
      setKursor(d.berikutnya ?? null);
    } catch (e) {
      setErr(`Gagal memuat timeline: ${(e as Error).message}`);
    } finally {
      setMuat(false);
    }
  }

  const cocok = FILTER.find((f) => f.v === filter)?.cocok ?? (() => true);
  const tampil = items.filter((i) => cocok(i));

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Timeline</div>
          <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
            <TabsList>
              {FILTER.map((f) => <TabsTrigger key={f.v} value={f.v}>{f.l}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        <p className="text-muted-foreground text-xs">
          Catat dari WA: <code>#CALL nama faskes: hasil telepon</code> atau <code>#NOTE nama faskes: catatan</code>.
          Telepon &amp; catatan di sini tidak dihitung ke KPI aktivitas — laporan kunjungan tetap lewat #REPORT.
        </p>

        {filter === "ar" && pembayaran && <RingkasanAr r={pembayaran} />}

        {err && <p className="text-destructive text-sm">{err}</p>}
        {!muat && !err && tampil.length === 0 && (
          <p className="text-muted-foreground py-4 text-sm">
            {items.length === 0 ? "Belum ada riwayat untuk account ini." : "Tidak ada riwayat untuk filter ini di baris yang sudah dimuat."}
          </p>
        )}

        <ol className="relative space-y-3 border-l border-border pl-5">
          {tampil.map((i) => {
            const g = GAYA[i.jenis];
            return (
              <li key={`${i.jenis}:${i.ref}`} className="relative">
                <span className={`absolute -left-[31px] top-0.5 flex size-5 items-center justify-center rounded-full ring-4 ring-card ${g.tone}`}>
                  <g.Icon className="size-3" aria-hidden />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${g.tone}`}>{g.label}</span>
                  {i.judul && <span className="text-sm font-medium">{i.judul}</span>}
                  <span className="text-muted-foreground text-xs">
                    {fmtWaktu(i.waktu, !["aktivitas", "faktur", "demo", "trial", "bayar"].includes(i.jenis))}
                    {i.oleh ? ` · ${i.oleh}` : ""}
                  </span>
                </div>
                {i.jenis === "faktur" ? (
                  <div className="text-sm">
                    {rp(i.nilai ?? 0)} <span className="text-muted-foreground text-xs">netto</span>
                    {(i.sisa ?? 0) > 0
                      ? <span className="ml-2 text-xs font-medium text-rose-600">sisa {rp(i.sisa ?? 0)}</span>
                      : <span className="text-muted-foreground ml-2 text-xs">{i.status ?? "lunas"}</span>}
                  </div>
                ) : i.jenis === "bayar" ? (
                  <div className="text-sm">
                    {rp(i.nilai ?? 0)} <span className="text-muted-foreground text-xs">netto</span>
                    <span className={`ml-2 text-xs font-medium ${i.status === "telat" ? "text-rose-600" : i.status === "tepat" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{i.isi}</span>
                  </div>
                ) : i.isi ? (
                  <div className="whitespace-pre-line text-sm">{i.isi}</div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {muat && <p className="text-muted-foreground text-sm">Memuat…</p>}
        {!muat && kursor && (
          <Button size="sm" variant="soft" onClick={() => void muatLagi(kursor)}>Muat lebih lama</Button>
        )}
      </CardContent>
    </Card>
  );
}
