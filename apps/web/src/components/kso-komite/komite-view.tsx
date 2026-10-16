"use client";

import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_KSO, type TabKso } from "@/lib/kso-komite-access";
import { cn } from "@/lib/utils";

import { RencanaDialog } from "./rencana-dialog";
import {
  GERBANG_CLS, POLA_STATUS, STATUS_LABEL, kirim, rpJt, waktu,
  type BarisAgenda, type BarisAntrean, type BarisKpi, type DataTab, type Ringkasan, type TabBoleh,
} from "./types";

// F170 Komite KSO — satu layar, tab per peran (tiap tab = fitur Akses Grup). Data & izin dari
// apps/api/src/repo/kso-komite.ts; tombol aksi hanya tampil bila tab itu boleh "edit", dan
// API memeriksanya lagi. AM tidak punya tombol apa pun — semua aksi AM lewat WhatsApp #KSO.
export function KomiteView({ tabs }: { tabs: TabBoleh[] }) {
  const [tab, setTab] = useState<TabKso>(tabs[0].tab);
  const [data, setData] = useState<Partial<Record<TabKso, DataTab>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [buka, setBuka] = useState<number | null>(null);

  const terapkan = useCallback((t: TabKso, p: Promise<DataTab>, batal: () => boolean) => {
    p.then((d) => { if (!batal()) { setData((x) => ({ ...x, [t]: d })); setErr(null); } })
      .catch((e: Error) => { if (!batal()) setErr(e.message); });
  }, []);
  useEffect(() => {
    let batal = false;
    terapkan(tab, kirim<DataTab>(`/api/kso-komite/${tab}`), () => batal);
    return () => { batal = true; };
  }, [tab, terapkan]);
  const muat = (t: TabKso) => terapkan(t, kirim<DataTab>(`/api/kso-komite/${t}`), () => false);

  const aktif = tabs.find((t) => t.tab === tab)!;
  const d = data[tab];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKso)} className="gap-4">
      <div className="-mx-1 overflow-x-auto px-1">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.tab} value={t.tab}>{TAB_KSO.find((x) => x.tab === t.tab)!.label}</TabsTrigger>
          ))}
        </TabsList>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {tabs.map((t) => (
        <TabsContent key={t.tab} value={t.tab} className="space-y-4">
          {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : (
            <>
              <PitaAlur r={d.ringkasan} />
              {t.tab === "saya" && (
                <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-800 dark:text-sky-300">
                  Layar ini <b>baca saja</b>. Semua aksi lewat WhatsApp: <code>#KSO</code> rencana baru, <code>#KSO D12 …</code> melengkapi,
                  {" "}<code>#KSO kirim D12</code> mengajukan, <code>#KSO kelonggaran</code> / <code>#KSO kalah</code>.
                </p>
              )}
              {t.tab === "kpi" ? <TabelKpi baris={d.kpi ?? []} /> : t.tab === "hod" ? (
                <>
                  <Bagian judul="Perlu putusan — jalur cepat" catatan="Dua HOD sepakat setuju = diputus. Batas 1 hari kerja; lewat batas = dianggap setuju."
                    nada="sky" baris={(d.baris ?? []).filter((b) => b.antrean === "HOD · Minta Putusan")} onBuka={setBuka} />
                  <Bagian judul="Perlu pendapat — jalur forum" catatan="Pendapat dibaca komite sebelum forum (batas 16.00 hari forum). Pendapat bukan putusan."
                    nada="amber" baris={(d.baris ?? []).filter((b) => b.antrean === "HOD · Minta Pendapat")} onBuka={setBuka} />
                </>
              ) : t.tab === "agenda" ? (
                <>
                  <Agenda baris={d.agenda ?? []} onBuka={setBuka} />
                  <Bagian judul="Diagendakan — rumuskan usulan ke Direksi" nada="sky"
                    baris={(d.baris ?? []).filter((b) => b.antrean === "Komite · Agenda Forum")} onBuka={setBuka} />
                  <Bagian judul="Mandat kedaluwarsa — tarik kembali ke forum" nada="amber"
                    baris={(d.baris ?? []).filter((b) => b.antrean === "Komite · Mandat Kedaluwarsa")} onBuka={setBuka} />
                </>
              ) : (
                <Bagian judul={JUDUL[t.tab]} catatan={CATATAN[t.tab]} nada="sky" baris={d.baris ?? []} onBuka={setBuka} />
              )}
            </>
          )}
        </TabsContent>
      ))}
      <RencanaDialog key={`${tab}-${buka ?? "tutup"}`} tab={tab} id={buka} bolehAksi={aktif.bolehAksi}
        onClose={() => setBuka(null)} onBerubah={() => muat(tab)} />
    </Tabs>
  );
}

const JUDUL: Partial<Record<TabKso, string>> = {
  saya: "Rencana KSO saya",
  direksi: "Menunggu putusan Direksi",
  penawaran: "Mandat berlaku — siap diterbitkan penawarannya",
  teknik: "PKS ditandatangani — jadwalkan pemasangan",
};
const CATATAN: Partial<Record<TabKso, string>> = {
  direksi: "Batas putusan 22.00 WIB hari forum. Setuju/Bersyarat wajib menetapkan mandat negosiasi.",
  penawaran: "Hanya mandat yang masih berlaku. Penawaran di bawah harga lantai ditolak sistem.",
  teknik: "Serah terima wajib nomor seri; verifikasi bulan ke-6 terjadwal otomatis.",
};

function PitaAlur({ r }: { r: Ringkasan }) {
  const isi: [string, number | string][] = [
    ["Menunggu HOD", r.menunggu_hod], ["Menunggu forum", r.menunggu_forum], ["Menunggu Direksi", r.menunggu_direksi],
    ["Siap penawaran", r.siap_penawaran], ["Ditahan", r.ditahan], ["Capex disetujui", rpJt(Number(r.capex_disetujui))],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {isi.map(([l, v]) => (
        <div key={l} className="bg-card rounded-lg border p-3">
          <div className="text-muted-foreground text-xs">{l}</div>
          <div className="mt-1 text-lg font-bold tabular-nums">{v}</div>
        </div>
      ))}
    </div>
  );
}

export function PolaGerbang({ pola }: { pola: string | null }) {
  if (!pola) return null;
  return (
    <span className="inline-flex gap-0.5" aria-label={`gerbang ${pola}`}>
      {pola.split("").map((c, i) => (
        <span key={i} className={cn("inline-block w-4 rounded text-center text-[10px] font-bold leading-4", GERBANG_CLS[POLA_STATUS[c] ?? "belum"])}>{i + 1}</span>
      ))}
    </span>
  );
}

function Bagian({ judul, catatan, nada, baris, onBuka }: {
  judul?: string; catatan?: string; nada: "sky" | "amber"; baris: BarisAntrean[]; onBuka: (id: number) => void;
}) {
  return (
    <section className="space-y-2">
      <div className={cn("border-l-4 pl-3", nada === "sky" ? "border-sky-500" : "border-amber-500")}>
        <h2 className="font-semibold">{judul} <span className="text-muted-foreground font-normal">({baris.length})</span></h2>
        {catatan && <p className="text-muted-foreground text-xs">{catatan}</p>}
      </div>
      {baris.length === 0 ? <EmptyState title="Antrean kosong" description="Tidak ada yang menunggu di sini." /> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {baris.map((b) => (
            <li key={`${b.antrean}-${b.id}`}>
              <button type="button" onClick={() => onBuka(b.id)}
                className="bg-card hover:border-primary w-full rounded-lg border p-3 text-left transition-colors">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{b.faskes_nama}</span>
                  <span className="text-muted-foreground text-xs">{b.nomor ?? `D${b.id}`} · {STATUS_LABEL[b.status] ?? b.status}</span>
                </div>
                <div className="text-muted-foreground mt-1 text-sm">{b.alat_nama} · {rpJt(b.capex)} · AM {b.am_nama}{b.cabang ? ` · ${b.cabang}` : ""}</div>
                {b.volume_sumber && <div className="mt-1 text-xs italic">Sumber volume: “{b.volume_sumber}”</div>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <PolaGerbang pola={b.pola_gerbang} />
                  {b.batas && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Batas {waktu(b.batas)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Agenda({ baris, onBuka }: { baris: BarisAgenda[]; onBuka: (id: number) => void }) {
  const forum = [...new Map(baris.map((b) => [b.forum_id, b])).values()];
  if (forum.length === 0) return <EmptyState title="Belum ada forum" description="Agenda terbit otomatis pukul 14.00 hari Selasa/Kamis." />;
  return (
    <section className="space-y-3">
      {forum.map((f) => {
        const isi = baris.filter((b) => b.forum_id === f.forum_id && b.rencana_id);
        return (
          <div key={f.forum_id} className="bg-card rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Forum {f.hari}, {f.tanggal}</span>
              <span className="text-muted-foreground text-xs">{f.mode === "portofolio" || isi.length === 0 ? "Tinjauan portofolio" : `${isi.filter((x) => x.jenis === "A").length} Agenda A`}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {isi.map((b) => (
                <li key={`${b.jenis}-${b.rencana_id}`}>
                  <button type="button" onClick={() => onBuka(b.rencana_id!)} className="hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm">
                    <span><b>{b.jenis}{b.urut ?? ""}</b> · {b.faskes_nama} · {b.alat_nama} · {rpJt(b.capex)}</span>
                    <span className="flex items-center gap-2"><PolaGerbang pola={b.pola_gerbang} /><span className="text-muted-foreground text-xs">pendapat HOD {b.pendapat_hod_masuk ?? 0}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

const KOLOM_KPI: [string, string, (v: unknown) => string][] = [
  ["usulan_diajukan", "Diajukan", String],
  ["usulan_jalur_cepat", "Jalur cepat", String],
  ["usulan_forum", "Forum", String],
  ["kelengkapan_pertama_persen", "Lengkap sekali kirim", (v) => `${v}%`],
  ["sumber_data_persen", "Sumber berbasis data", (v) => `${v}%`],
  ["realisasi_harga_rata", "Realisasi harga ÷ lantai", (v) => String(v)],
  ["capex_ditempatkan", "Capex ditempatkan", (v) => rpJt(Number(v))],
  ["akurasi_volume_median", "Akurasi volume bln-6", (v) => String(v)],
  ["capex_terverifikasi", "Capex terverifikasi", (v) => rpJt(Number(v))],
  ["flag_pemecahan_paket", "Pecah paket", String],
];

function TabelKpi({ baris }: { baris: BarisKpi[] }) {
  if (baris.length === 0) return <EmptyState title="Belum ada usulan yang diajukan" description="KPI terisi setelah AM mengajukan rencana lewat #KSO." />;
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="p-2">AM</th><th className="p-2">Periode</th>
          {KOLOM_KPI.map(([k, l]) => <th key={k} className="p-2 text-right">{l}</th>)}
        </tr></thead>
        <tbody>
          {baris.map((b) => (
            <tr key={`${b.am_id}-${b.periode}`} className="border-b last:border-0">
              <td className="p-2 font-medium">{b.am_nama}</td><td className="p-2">{b.periode}</td>
              {/* angka kosong = belum ada data (mis. akurasi bulan-6 sebelum PKS mewajibkan lapor test), BUKAN nol */}
              {KOLOM_KPI.map(([k, , f]) => (
                <td key={k} className="p-2 text-right tabular-nums">
                  {b[k] == null ? <span className="text-muted-foreground text-xs">belum ada data</span> : f(b[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
