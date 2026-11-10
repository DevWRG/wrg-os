"use client";

import { Check, CircleDashed, Copy, ExternalLink, FileCheck2, Info, Minus, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/sph/sph-ui";
import type { TabKso } from "@/lib/kso-komite-access";
import {
  LABEL_LAMPIRAN, URUT_COCOK, hargaBersih, keadaanBerkas, kelengkapan, persenFee, statusLampiran, teksDiunggah, teksGalatOcr,
  type StatusLampiran,
} from "@/lib/kso-komite-daftar";
import { cn } from "@/lib/utils";

import { salinTeks } from "./salin";
import { rp, waktu, type CocokIsian, type Detail, type Lampiran, type StatusCocok } from "./types";

// 302 — bagian panel rincian: "Yang masih kurang" (checklist + contoh balasan WA siap salin) dan
// "Lampiran PDF Simulator" (isi PDF dibaca OCR, dicocokkan dengan isian WA). Data dari API apa adanya:
// daftar kurang & hasil cocok dihitung apps/api (kso-format.ts) — satu sumber dengan balasan WA.

const LAMPIRAN_CLS: Record<StatusLampiran, string> = {
  belum: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  cocok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  beda: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  galat: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/** ringkas = tanpa kata "Lampiran" (di kolom tabel yang judulnya sudah menyebut lampiran). */
export function ChipLampiran({ status, className, ringkas = false }: { status: StatusLampiran; className?: string; ringkas?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", LAMPIRAN_CLS[status], className)}>
      {status === "cocok" ? <Check className="size-3" aria-hidden /> : status === "belum" ? <CircleDashed className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {ringkas ? LABEL_LAMPIRAN[status] : status === "belum" ? "Lampiran belum ada" : status === "cocok" ? "Lampiran cocok" : LABEL_LAMPIRAN[status]}
    </span>
  );
}

const COCOK_CLS: Record<StatusCocok, string> = {
  cocok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  beda: "bg-red-500/10 text-red-700 dark:text-red-400",
  kosong: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
};
const COCOK_KATA: Record<StatusCocok, string> = { cocok: "Cocok", beda: "Beda", kosong: "Kosong" };

function ChipCocok({ s }: { s: StatusCocok }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", COCOK_CLS[s])}>
      {s === "cocok" ? <Check className="size-3" aria-hidden /> : s === "beda" ? <X className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
      {COCOK_KATA[s]}
    </span>
  );
}

/** 305: lampiran sudah diunggah & dibaca, berkas PDF tidak disimpan di server. */
function ChipDiunggah({ teks }: { teks: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
      <FileCheck2 className="size-3.5" aria-hidden />{teks}
    </span>
  );
}

const urlPdf = (tab: TabKso, id: number, lid: number) => `/api/kso-komite/${tab}/rencana/${id}/lampiran/${lid}`;

function Info1({ nada, children }: { nada: "sky" | "amber" | "red"; children: React.ReactNode }) {
  const cls = {
    sky: "border-sky-600 bg-sky-500/10 text-sky-900 dark:text-sky-200",
    amber: "border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200",
    red: "border-red-600 bg-red-500/10 text-red-800 dark:text-red-300",
  }[nada];
  return <p className={cn("flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm", cls)}><Info className="mt-0.5 size-4 shrink-0" aria-hidden /><span>{children}</span></p>;
}

// ---------------------------------------------------------------- yang masih kurang

export function BagianKurang({ d }: { d: Detail }) {
  const { toast, node } = useToast();
  const kurang = d.kurang;
  const s = d.rencana.status;
  if (!kurang || (kurang.length === 0 && s !== "DRAFT" && s !== "DITAHAN")) return null;
  const k = kelengkapan(kurang);
  const salin = async (teks: string) => {
    if (await salinTeks(teks)) toast("sukses", "Disalin", teks);
    else toast("gagal", "Gagal menyalin", `Salin manual: ${teks}`);
  };
  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4 shadow-[var(--shadow-card)]">
      {node}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Yang masih kurang</h3>
        <span className="text-muted-foreground text-xs tabular-nums">
          {k.kurang === 0 ? "semua isian lengkap" : `${k.kurang} dari ${k.total} isian kurang`}
        </span>
      </div>
      <BarLengkap persen={k.persen} />
      {kurang.length === 0 ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">Semua isian lengkap dan PDF cocok — rencana diajukan otomatis.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">Salin contoh balasan, ubah isinya, lalu kirim ke chat WhatsApp bot. Lengkap + PDF cocok → diajukan otomatis.</p>
          <ul className="space-y-2.5">
            {kurang.map((x) => (
              <li key={x.kunci} className="flex items-start gap-2.5">
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{x.teks}</p>
                  <div className="flex items-center gap-2">
                    <code className="border-border min-w-0 flex-1 rounded-md border bg-white px-2 py-1 font-mono text-xs break-words dark:bg-card">{x.contoh}</code>
                    <Button type="button" size="sm" variant="soft" onClick={() => salin(x.contoh)} aria-label={`Salin contoh: ${x.contoh}`}>
                      <Copy aria-hidden />Salin
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function BarLengkap({ persen, className }: { persen: number; className?: string }) {
  const warna = persen >= 100 ? "bg-emerald-600" : persen >= 70 ? "bg-sky-600" : persen >= 40 ? "bg-amber-500" : "bg-red-600";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700", className)}
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={persen} aria-label={`kelengkapan ${persen}%`}>
      <div className={cn("h-full rounded-full", warna)} style={{ width: `${Math.max(4, persen)}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- lampiran

export function BagianLampiran({ tab, d }: { tab: TabKso; d: Detail }) {
  const r = d.rencana;
  if (d.lampiran === undefined) return null; // API lama (sebelum 302)
  const l = d.lampiran_terakhir ?? d.lampiran[0] ?? null;
  const st = statusLampiran(l);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">Lampiran PDF Simulator <ChipLampiran status={st} /></h3>
        {/* PDF Simulator memuat biaya (capex, reagen, CPRR) → tidak dibuka untuk respons yang disaring (API 403) */}
        {keadaanBerkas(l) === "buka" && !d.tanpa_angka && (
          <a href={urlPdf(tab, r.id, l!.id)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "sm" }))}>
            <ExternalLink aria-hidden />Buka PDF
          </a>
        )}
        {/* 305: PDF tidak disimpan sesudah dibaca — yang tersisa hasil bacanya (perbandingan PDF vs WA di bawah) */}
        {l && keadaanBerkas(l) === "diunggah" && <ChipDiunggah teks={teksDiunggah(l, waktu)} />}
      </div>
      {!l ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
          Belum ada PDF. AM mengirim <b>#KSO {r.nomor ?? `D${r.id}`}</b> lalu PDF Simulator KSO di chat WA dalam 10 menit.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Diterima {waktu(l.dibuat_at)}{l.tanggal ? ` · tanggal di PDF ${l.tanggal}` : ""}
          </p>
          {st === "galat" && <Info1 nada="red">PDF belum bisa dipakai: {teksGalatOcr(l.galat)}.</Info1>}
          {l.cocok && Object.keys(l.cocok).length > 0 && <TabelCocok cocok={l.cocok} />}
          {!d.tanpa_angka && <Cprr l={l} harga={r.harga_per_test} fee={r.fee_persen ?? null} />}
          {(l.peringatan ?? []).map((p) => <Info1 key={p} nada="sky">Catatan baca PDF: {p}</Info1>)}
        </>
      )}
      {d.lampiran.length > 1 && (
        <div>
          <h4 className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">Riwayat lampiran ({d.lampiran.length})</h4>
          <ul className="divide-border divide-y text-sm">
            {d.lampiran.map((x, i) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="tabular-nums">{waktu(x.dibuat_at)}{i === 0 && <span className="text-muted-foreground"> · terbaru</span>}</span>
                <span className="flex items-center gap-2">
                  <ChipLampiran status={statusLampiran(x)} />
                  {x.ada_berkas && !d.tanpa_angka && (
                    <a href={urlPdf(tab, r.id, x.id)} target="_blank" rel="noreferrer" className="text-primary text-xs font-medium hover:underline">PDF</a>
                  )}
                  {keadaanBerkas(x) === "diunggah" && <span className="text-muted-foreground text-xs">sudah dibaca</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Perbandingan isian PDF vs WA per baris (6 isian) — daftar bergaris, bertumpuk di layar sempit. */
function TabelCocok({ cocok }: { cocok: Record<string, CocokIsian> }) {
  const kunci = [...URUT_COCOK.filter((k) => cocok[k]), ...Object.keys(cocok).filter((k) => !(URUT_COCOK as readonly string[]).includes(k))];
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="text-muted-foreground hidden grid-cols-[8rem_1fr_1fr_5.5rem] gap-3 border-b bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide sm:grid dark:bg-card">
        <span>Isian</span><span>Di PDF</span><span>Di WA</span><span className="text-right">Hasil</span>
      </div>
      <ul className="divide-border divide-y">
        {kunci.map((k) => {
          const c = cocok[k];
          return (
            <li key={k} className={cn("grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[8rem_1fr_1fr_5.5rem] sm:items-center",
              c.status === "beda" && "bg-red-500/5")}>
              <span className="font-medium">{c.label}</span>
              <span className="sm:order-last sm:text-right"><ChipCocok s={c.status} /></span>
              <span className="col-span-2 min-w-0 break-words sm:col-span-1"><span className="text-muted-foreground sm:hidden">PDF: </span>{c.pdf ?? <i className="text-muted-foreground">tidak terbaca</i>}</span>
              <span className="col-span-2 min-w-0 break-words sm:col-span-1"><span className="text-muted-foreground sm:hidden">WA: </span>{c.wa ?? <i className="text-muted-foreground">belum diisi</i>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** CPRR Simulator vs permintaan harga AM (info, bukan penghalang). */
function Cprr({ l, harga, fee }: { l: Lampiran; harga: number | null; fee: number | null }) {
  const x = l.isian;
  const c = x?.cprr_per_test ?? null;
  if (c == null && harga == null) return null;
  const bersih = hargaBersih(harga, fee);
  const diBawah = c != null && harga != null && harga < c;
  const rinci: [string, number | null | undefined, string?][] = [
    ["capex", x?.capex_per_test], ["reagen", x?.reagen_per_test], ["QC", x?.qc_per_test], ["base cost", x?.base_cost_per_test],
  ];
  const ada = rinci.filter(([, v]) => v != null);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Ubin label="CPRR Simulator" nilai={c != null ? rp(c) : "—"} ket="per test" />
        <Ubin label="Permintaan harga" nilai={rp(harga)} ket="per test" nada={diBawah ? "merah" : undefined} />
        <Ubin label="Harga bersih" nilai={rp(bersih)} ket={`fee ${persenFee(fee)}`} />
      </div>
      {diBawah && <Info1 nada="red">Permintaan harga <b>di bawah CPRR</b> Simulator ({rp(harga)} &lt; {rp(c)} per test).</Info1>}
      {(ada.length > 0 || x?.markup_persen != null) && (
        <p className="text-muted-foreground text-xs">
          Rincian CPRR per test: {ada.map(([k, v]) => `${k} ${rp(v)}`).join(" · ")}
          {x?.markup_persen != null ? ` · markup ${x.markup_persen.toLocaleString("id-ID")}%` : ""}
          {x?.hari_kerja != null ? ` · ${x.hari_kerja} hari kerja` : ""}
        </p>
      )}
    </div>
  );
}

function Ubin({ label, nilai, ket, nada }: { label: string; nilai: string; ket?: string; nada?: "merah" }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", nada === "merah" && "border-red-500/60")}>
      <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{label}</div>
      <div className={cn("font-semibold tabular-nums", nada === "merah" && "text-red-700 dark:text-red-400")}>{nilai}</div>
      {ket && <div className="text-muted-foreground text-xs">{ket}</div>}
    </div>
  );
}
