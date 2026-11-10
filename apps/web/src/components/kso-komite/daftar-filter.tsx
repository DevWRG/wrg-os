"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleAlert, ClipboardList, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { TabKso } from "@/lib/kso-komite-access";
import {
  hariIniWib, kelengkapan, nadaBerlaku, persenFee, relatif, saringBelumLengkap, saringLolos, sisaHari, statusLampiran,
  type FilterDaftar, type NadaBerlaku,
} from "@/lib/kso-komite-daftar";
import { cn } from "@/lib/utils";

import { BarLengkap, ChipLampiran } from "./lampiran-kurang";
import { LabelStatus } from "./label-status";
import { LABEL_ZONA, ZONA_CLS, kirim, persen, rp, type BarisDaftar, type DataDaftar } from "./types";

// 302 — dua daftar lintas status: "Belum lengkap" (DRAFT/DITAHAN yang isian #KSO-nya kurang) dan
// "Lolos tanpa forum" (DIPUTUS_AM zona AM + DIPUTUS_HOD jalur cepat, mandat otomatis). Diminta lewat
// SATU tab peran (pilihTabDaftar) — API menyaring dengan RLS peran itu, jadi AM melihat miliknya,
// HOD wilayahnya, Komite/Sekretariat/Direksi semuanya. Klik baris = buka rincian (panel kanan / dialog).

/** segar: naik sesudah aksi di panel rincian → daftar dimuat ulang tanpa mengosongkan penyaring. */
type Props = { tab: TabKso; cakupan: string; onBuka: (id: number) => void; segar?: number };

function useDaftar(tab: TabKso, filter: FilterDaftar, segar = 0) {
  const [data, setData] = useState<BarisDaftar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  useEffect(() => {
    let batal = false;
    kirim<DataDaftar>(`/api/kso-komite/${tab}/daftar/${filter}`)
      .then((x) => { if (!batal) { setData(x.baris); setErr(null); } })
      .catch((e: Error) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, [tab, filter, versi, segar]);
  const muatUlang = () => { setErr(null); setData(null); setVersi((v) => v + 1); };
  return { data, err, muatUlang };
}

/** Chip penyaring: aktif = garis primary-dark + teks foreground (bukan warna brand di atas chip lembut). */
function Chip({ aktif, onClick, children }: { aktif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={aktif} onClick={onClick}
      className={cn("bg-card inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        aktif ? "border-primary-dark text-foreground ring-primary-dark ring-1" : "border-border text-muted-foreground hover:text-foreground hover:border-primary-dark/60")}>
      {children}
    </button>
  );
}
const Hitung = ({ n }: { n: number }) => <span className="tabular-nums opacity-80">{n}</span>;

function Kerangka({ judul, deskripsi }: { judul: string; deskripsi: string }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{judul}</CardTitle><CardDescription>{deskripsi}</CardDescription></CardHeader>
      <CardContent className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent>
    </Card>
  );
}

function Galat({ judul, err, muatUlang }: { judul: string; err: string; muatUlang: () => void }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{judul}</CardTitle></CardHeader>
      <CardContent>
        <EmptyState icon={CircleAlert} title="Daftar gagal dimuat" description={err}
          action={<Button size="sm" variant="outline" onClick={muatUlang}>Coba lagi</Button>} />
      </CardContent>
    </Card>
  );
}

function ChipZona({ b }: { b: Pick<BarisDaftar, "zona" | "gpm_deal"> }) {
  // gpm_deal tidak ada = respons disaring (AM / HOD Sales / Admin Sales, 10 Nov) → hanya zona (bila sudah ada)
  if (!b.zona) return <span className="text-muted-foreground text-xs">{b.gpm_deal === undefined ? "—" : `GPM ${persen(b.gpm_deal)}`}</span>;
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums", ZONA_CLS[b.zona])}>
      {LABEL_ZONA[b.zona]}{b.gpm_deal != null ? ` · ${persen(b.gpm_deal)}` : ""}
    </span>
  );
}

function SelRencana({ b, children }: { b: BarisDaftar; children?: React.ReactNode }) {
  return (
    <div className="min-w-[10rem] space-y-0.5">
      <div className="font-semibold whitespace-normal">{b.faskes_nama}</div>
      <div className="text-muted-foreground text-xs whitespace-normal">
        <span className="font-mono text-[11px]">{b.nomor ?? `D${b.id}`}</span> · {b.alat_nama} · {b.am_nama}{b.cabang ? ` — ${b.cabang}` : ""}
      </div>
      {children}
    </div>
  );
}

/** Fee + harga bersih; harga bersih tidak ada di respons yang disaring → fee saja. */
const teksFee = (b: BarisDaftar) =>
  b.fee_persen == null ? "fee belum diisi" : b.fee_persen === 0 ? "tanpa fee"
    : `fee ${persenFee(b.fee_persen)}${b.harga_bersih !== undefined ? ` → ${rp(b.harga_bersih)}` : ""}`;

function SelHarga({ b }: { b: BarisDaftar }) {
  return (
    <div className="tabular-nums">
      <div className="font-medium">{rp(b.harga_per_test)}</div>
      <div className="text-muted-foreground text-xs whitespace-nowrap">
        {teksFee(b)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Belum lengkap

export function DaftarBelumLengkap({ tab, cakupan, onBuka, segar }: Props) {
  const { data, err, muatUlang } = useDaftar(tab, "belum-lengkap", segar);
  const [tanpaLampiran, setTanpaLampiran] = useState(false);
  const [lampiranBeda, setLampiranBeda] = useState(false);
  const baris = useMemo(() => saringBelumLengkap(data ?? [], { tanpaLampiran, lampiranBeda }), [data, tanpaLampiran, lampiranBeda]);
  const judul = "Belum lengkap";
  const deskripsi = `Draft dan rencana ditahan yang isian #KSO-nya belum lengkap · cakupan: ${cakupan}.`;
  if (err) return <Galat judul={judul} err={err} muatUlang={muatUlang} />;
  if (!data) return <Kerangka judul={judul} deskripsi={deskripsi} />;
  const nTanpa = data.filter((b) => !b.lampiran).length, nBeda = data.filter((b) => b.lampiran && !b.lampiran.lolos).length;

  const kolom: DataColumn<BarisDaftar>[] = [
    {
      id: "rencana", header: "Rencana", sortable: true,
      accessor: (b) => `${b.faskes_nama} · ${b.alat_nama} · ${b.am_nama} · ${b.cabang ?? ""} · ${b.nomor ?? `D${b.id}`}`,
      cell: (b) => (
        <SelRencana b={b}>
          {/* layar sempit: kolom lain disembunyikan → ringkasannya ikut di sini */}
          <div className="space-y-1.5 pt-1 md:hidden">
            <div className="flex flex-wrap items-center gap-1.5"><ChipZona b={b} /><ChipLampiran status={statusLampiran(b.lampiran)} /></div>
            <div className="text-xs tabular-nums">{rp(b.harga_per_test)} · {teksFee(b)}</div>
            <SelLengkap b={b} />
          </div>
        </SelRencana>
      ),
    },
    { id: "harga", header: "Harga → bersih", align: "right", sortable: true, searchable: false, className: "hidden md:table-cell",
      accessor: (b) => b.harga_bersih ?? b.harga_per_test, cell: (b) => <SelHarga b={b} /> },
    { id: "zona", header: "GPM · lampiran", sortable: true, className: "hidden md:table-cell",
      accessor: (b) => statusLampiran(b.lampiran),
      cell: (b) => <div className="flex flex-col items-start gap-1"><ChipZona b={b} /><ChipLampiran ringkas status={statusLampiran(b.lampiran)} /></div> },
    { id: "kurang", header: "Kelengkapan", sortable: true, searchable: false, className: "hidden md:table-cell",
      accessor: (b) => b.kurang?.length ?? 0, cell: (b) => <SelLengkap b={b} /> },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{judul} <span className="text-muted-foreground text-sm font-normal tabular-nums">{data.length}</span></CardTitle>
        <CardDescription>{deskripsi}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Semua rencana sudah lengkap"
            description="Tidak ada draft yang menunggu isian. Rencana baru masuk lewat WhatsApp #KSO." />
        ) : (
          <DataTable columns={kolom} data={baris} getKey={(b) => String(b.id)} pageSize={10} onRowClick={(b) => onBuka(b.id)}
            searchPlaceholder="Cari faskes, AM, atau alat…" empty="Tidak ada yang cocok dengan penyaring."
            toolbar={<>
              <Chip aktif={tanpaLampiran} onClick={() => setTanpaLampiran((v) => !v)}>Tanpa lampiran <Hitung n={nTanpa} /></Chip>
              <Chip aktif={lampiranBeda} onClick={() => setLampiranBeda((v) => !v)}>Lampiran beda <Hitung n={nBeda} /></Chip>
              {(tanpaLampiran || lampiranBeda) && (
                <Button size="sm" variant="ghost" onClick={() => { setTanpaLampiran(false); setLampiranBeda(false); }}>Reset</Button>
              )}
            </>} />
        )}
      </CardContent>
    </Card>
  );
}

function SelLengkap({ b }: { b: BarisDaftar }) {
  const k = kelengkapan(b.kurang ?? []);
  return (
    <div className="w-24 space-y-1" title={(b.kurang ?? []).map((x) => `• ${x.teks}`).join("\n")}>
      <div className="text-xs font-medium whitespace-nowrap tabular-nums" aria-label={`${k.kurang} dari ${k.total} isian kurang`}>{k.kurang} kurang <span className="text-muted-foreground font-normal">/ {k.total}</span></div>
      <BarLengkap persen={k.persen} />
      <div className="text-muted-foreground text-[11px]">diubah {relatif(b.diubah_at ?? b.dibuat_at)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Lolos tanpa forum

const BERLAKU_CLS: Record<NadaBerlaku, string> = {
  lewat: "bg-red-500/10 text-red-700 dark:text-red-400",
  segera: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  aman: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  kosong: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};
const tglId = (s: string | null | undefined) =>
  s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

function SelBerlaku({ b, hariIni }: { b: BarisDaftar; hariIni: string }) {
  const sisa = sisaHari(b.mandat?.berlaku_sampai, hariIni);
  const nada = nadaBerlaku(sisa);
  return (
    <div className="space-y-1">
      <div className="tabular-nums">{tglId(b.mandat?.berlaku_sampai)}</div>
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", BERLAKU_CLS[nada])}>
        {nada === "kosong" ? "tanpa mandat" : nada === "lewat" ? `lewat ${-sisa!} hari` : sisa === 0 ? "berakhir hari ini" : `${sisa} hari lagi`}
      </span>
    </div>
  );
}

function SelMandat({ b }: { b: BarisDaftar }) {
  const m = b.mandat;
  if (!m) return <span className="text-muted-foreground text-xs">mandat belum ada</span>;
  // respons disaring: harga mandat tidak dikirim (Admin Sales tetap menerima pembuka)
  const isi = ([["Pembuka", m.harga_pembuka, true], ["Target", m.harga_target, false], ["Batas bawah", m.harga_lantai, false]] as const)
    .filter(([, v]) => v !== undefined);
  if (isi.length === 0) return <span className="text-xs">mandat terbit</span>;
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-2 text-xs tabular-nums">
      {isi.map(([l, v, tebal]) => (
        <Fragment key={l}><dt className="text-muted-foreground">{l}</dt><dd className={cn("text-right", tebal && "font-semibold")}>{rp(v)}</dd></Fragment>
      ))}
    </dl>
  );
}

export function DaftarLolos({ tab, cakupan, onBuka, segar }: Props) {
  const { data, err, muatUlang } = useDaftar(tab, "lolos-tanpa-forum", segar);
  const [zona, setZona] = useState<"" | "am" | "hod">("");
  const [segera, setSegera] = useState(false);
  const hariIni = hariIniWib();
  const baris = useMemo(() => saringLolos(data ?? [], { zona, segera }, hariIni), [data, zona, segera, hariIni]);
  const judul = "Lolos tanpa forum";
  const deskripsi = `Semua gerbang hijau: diputus AM (zona AM) atau 2 HOD (jalur cepat), mandat terbit otomatis · cakupan: ${cakupan}.`;
  if (err) return <Galat judul={judul} err={err} muatUlang={muatUlang} />;
  if (!data) return <Kerangka judul={judul} deskripsi={deskripsi} />;
  const n = (z: "am" | "hod") => data.filter((b) => b.zona === z).length;
  const nSegera = saringLolos(data, { zona: "", segera: true }, hariIni).length;

  const kolom: DataColumn<BarisDaftar>[] = [
    {
      id: "rencana", header: "Rencana", sortable: true,
      accessor: (b) => `${b.faskes_nama} · ${b.alat_nama} · ${b.am_nama} · ${b.cabang ?? ""} · ${b.nomor ?? `D${b.id}`}`,
      cell: (b) => (
        <SelRencana b={b}>
          <div className="flex flex-wrap items-center gap-1.5 pt-1"><LabelStatus status={b.status} /><span className="md:hidden"><ChipZona b={b} /></span></div>
          <div className="space-y-1.5 pt-1 md:hidden">
            <SelMandat b={b} />
            <SelBerlaku b={b} hariIni={hariIni} />
          </div>
        </SelRencana>
      ),
    },
    { id: "zona", header: "Zona · GPM", sortable: true, searchable: false, className: "hidden md:table-cell",
      accessor: (b) => b.gpm_deal ?? null, cell: (b) => <ChipZona b={b} /> },
    { id: "mandat", header: "Mandat (Rp/test)", sortable: true, searchable: false, className: "hidden md:table-cell",
      accessor: (b) => b.mandat?.harga_pembuka ?? null, cell: (b) => <SelMandat b={b} /> },
    { id: "berlaku", header: "Berlaku s/d", sortable: true, searchable: false, className: "hidden md:table-cell",
      accessor: (b) => b.mandat?.berlaku_sampai ?? null,
      cell: (b) => (
        <div className="space-y-1">
          <SelBerlaku b={b} hariIni={hariIni} />
          <div className="text-muted-foreground text-[11px]">diputus {relatif(b.diubah_at ?? b.diajukan_at)}</div>
        </div>
      ) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{judul} <span className="text-muted-foreground text-sm font-normal tabular-nums">{data.length}</span></CardTitle>
        <CardDescription>{deskripsi}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Belum ada yang lolos tanpa forum"
            description="Rencana yang semua gerbangnya hijau di zona AM atau 2 HOD akan muncul di sini beserta mandatnya." />
        ) : (
          <DataTable columns={kolom} data={baris} getKey={(b) => String(b.id)} pageSize={10} onRowClick={(b) => onBuka(b.id)}
            searchPlaceholder="Cari faskes, AM, atau alat…" empty="Tidak ada yang cocok dengan penyaring."
            initialSort={{ id: "berlaku", dir: "asc" }}
            toolbar={<>
              <Chip aktif={zona === ""} onClick={() => setZona("")}>Semua zona <Hitung n={data.length} /></Chip>
              <Chip aktif={zona === "am"} onClick={() => setZona("am")}>Zona AM <Hitung n={n("am")} /></Chip>
              <Chip aktif={zona === "hod"} onClick={() => setZona("hod")}>Zona 2 HOD <Hitung n={n("hod")} /></Chip>
              <Chip aktif={segera} onClick={() => setSegera((v) => !v)}>Mandat ≤ 7 hari <Hitung n={nSegera} /></Chip>
            </>} />
        )}
      </CardContent>
    </Card>
  );
}
