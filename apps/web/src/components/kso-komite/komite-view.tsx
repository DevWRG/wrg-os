"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_KSO, type TabKso } from "@/lib/kso-komite-access";
import { cn } from "@/lib/utils";

import { pilihTabDaftar } from "@/lib/kso-komite-daftar";

import { BottomLinePanel } from "./bottom-line";
import { DaftarBelumLengkap, DaftarLolos } from "./daftar-filter";
import { TombolFormatKso } from "./format-kso";
import { BadgeFaskesBaru, LabelStatus } from "./label-status";
import { PortofolioPanel } from "./portofolio";
import { RencanaDialog, RencanaPanel } from "./rencana-dialog";
import { SusunanPanel } from "./susunan-panel";
import {
  GERBANG_SOLID, LABEL_ZONA, POLA_STATUS, ZONA_CLS, kirim, persen, rpJt, waktu,
  type BarisAgenda, type BarisAntrean, type BarisKpi, type DataTab, type Ringkasan, type TabBoleh,
} from "./types";

// F170 Komite KSO — satu layar, tab per peran (tiap tab = fitur Akses Grup). Data & izin dari
// apps/api/src/repo/kso-komite.ts; tombol aksi hanya tampil bila tab itu boleh "edit", dan
// API memeriksanya lagi. AM tidak punya tombol apa pun — semua aksi AM lewat WhatsApp #KSO.
// Tab "Bottom Line Alat" (F172) bukan tab peran: datanya sendiri (/api/kso-komite/bottom-line) dan
// izinnya fitur kso-komite-bottomline — tampil bila `bottomLine` true. Tab "Tinjauan Portofolio" (F170 Fase D)
// memakai izin yang sama.
// Tab "Belum lengkap" & "Lolos tanpa forum" (302) bukan tab peran: daftar lintas status yang diminta
// lewat satu tab peran milik pengguna (pilihTabDaftar — cakupan terluas), jadi tak butuh fitur baru.
type TabDaftar = "belum-lengkap" | "lolos-tanpa-forum";
type TabLayar = TabKso | "bottomline" | "portofolio" | TabDaftar;
const isDaftar = (t: TabLayar): t is TabDaftar => t === "belum-lengkap" || t === "lolos-tanpa-forum";
const isPeran = (t: TabLayar): t is TabKso => t !== "bottomline" && t !== "portofolio" && !isDaftar(t);

export function KomiteView({ tabs, bottomLine = false }: { tabs: TabBoleh[]; bottomLine?: boolean }) {
  const [tab, setTab] = useState<TabLayar>(tabs[0]?.tab ?? "bottomline");
  const [data, setData] = useState<Partial<Record<TabKso, DataTab>>>({});
  const [err, setErr] = useState<string | null>(null);
  const [buka, setBuka] = useState<number | null>(null);
  const [segar, setSegar] = useState(0);
  const sumber = { "belum-lengkap": pilihTabDaftar(tabs, "belum-lengkap"), "lolos-tanpa-forum": pilihTabDaftar(tabs, "lolos-tanpa-forum") };

  const terapkan = useCallback((t: TabKso, p: Promise<DataTab>, batal: () => boolean) => {
    p.then((d) => { if (!batal()) { setData((x) => ({ ...x, [t]: d })); setErr(null); } })
      .catch((e: Error) => { if (!batal()) setErr(e.message); });
  }, []);
  useEffect(() => {
    if (!isPeran(tab)) return;
    let batal = false;
    terapkan(tab, kirim<DataTab>(`/api/kso-komite/${tab}`), () => batal);
    return () => { batal = true; };
  }, [tab, terapkan]);
  const muat = (t: TabKso) => terapkan(t, kirim<DataTab>(`/api/kso-komite/${t}`), () => false);

  const aktif = isDaftar(tab) ? sumber[tab]?.tab ?? null : isPeran(tab) ? tabs.find((t) => t.tab === tab) ?? null : null;
  const lebar = useLayarLebar();
  const d = isPeran(tab) ? data[tab] : undefined;
  // sesudah aksi di rincian: muat ulang antrean tab peran / daftar yang sedang dibuka
  const berubah = (t: TabKso) => { if (isPeran(tab)) muat(t); else setSegar((x) => x + 1); };

  return (
    <Tabs value={tab} onValueChange={(v) => { setTab(v as TabLayar); setBuka(null); }} className="gap-4">
      {tabs.length > 0 && <SusunanPanel />}
      <div className="flex items-center gap-2">
        <div className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.tab} value={t.tab}>{TAB_KSO.find((x) => x.tab === t.tab)!.label}</TabsTrigger>
            ))}
            {sumber["belum-lengkap"] && <TabsTrigger value="belum-lengkap">Belum lengkap</TabsTrigger>}
            {sumber["lolos-tanpa-forum"] && <TabsTrigger value="lolos-tanpa-forum">Lolos tanpa forum</TabsTrigger>}
            {bottomLine && <TabsTrigger value="bottomline">Bottom Line Alat</TabsTrigger>}
            {bottomLine && <TabsTrigger value="portofolio">Tinjauan Portofolio</TabsTrigger>}
          </TabsList>
        </div>
        {tabs.length > 0 && <TombolFormatKso />}
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
              {t.tab === "kpi" ? <TabelKpi baris={d.kpi ?? []} /> : (
                <DuaKolom panel={lebar && aktif?.tab === t.tab ? (
                  <RencanaPanel key={`${t.tab}-${buka ?? "kosong"}`} tab={t.tab} id={buka} bolehAksi={t.bolehAksi}
                    onBerubah={() => muat(t.tab)} />
                ) : null}>
                {t.tab === "hod" ? (
                <>
                  <Bagian judul="Perlu putusan — jalur cepat" catatan="Dua HOD sepakat setuju = diputus. Batas 1 hari kerja; lewat batas = dianggap setuju."
                    nada="sky" baris={(d.baris ?? []).filter((b) => b.antrean === "HOD · Minta Putusan")} onBuka={setBuka} pilih={buka} />
                  <Bagian judul="Perlu pendapat — jalur forum" catatan="Pendapat dibaca komite sebelum forum (batas 16.00 hari forum). Pendapat bukan putusan."
                    nada="amber" baris={(d.baris ?? []).filter((b) => b.antrean === "HOD · Minta Pendapat")} onBuka={setBuka} pilih={buka} />
                </>
              ) : t.tab === "agenda" ? (
                <>
                  <Agenda baris={d.agenda ?? []} onBuka={setBuka} pilih={buka} />
                  <Bagian judul="Diagendakan — rumuskan usulan ke Direksi" nada="sky"
                    baris={(d.baris ?? []).filter((b) => b.antrean === "Komite · Agenda Forum")} onBuka={setBuka} pilih={buka} />
                  <Bagian judul="Mandat kedaluwarsa — tarik kembali ke forum" nada="amber"
                    baris={(d.baris ?? []).filter((b) => b.antrean === "Komite · Mandat Kedaluwarsa")} onBuka={setBuka} pilih={buka} />
                </>
              ) : t.tab === "sekretariat" ? (
                <>
                  <Bagian judul="Verifikasi bukti volume — zona Forum & Direktur" catatan="Bukti tertulis (rekap LIS/SIMRS, pembelian reagen RS, surat RS) dicek sebelum forum. Usulan yang belum dicek tidak masuk Agenda A — ia ikut forum sesudah diverifikasi. Perkiraan lisan tidak diterima."
                    nada="amber" baris={d.verifikasi ?? []} onBuka={setBuka} pilih={buka} />
                  <Bagian judul="Mandat berlaku — terbitkan penawaran" catatan="Terbit pagi setelah putusan. Harga awal = harga pembuka; di bawah batas bawah ditolak sistem."
                    nada="sky" baris={(d.baris ?? []).filter((b) => b.antrean === "Sekretariat · Terbitkan Penawaran")} onBuka={setBuka} pilih={buka} />
                  <Bagian judul="Negosiasi berjalan — cocokkan PKS atau catat kalah" catatan="PKS dicocokkan dengan putusan (harga, volume minimum, tenor, klausul) sebelum tanda tangan. Tidak cocok = tidak ditandatangani."
                    nada="amber" baris={(d.baris ?? []).filter((b) => b.antrean === "Sekretariat · Cocokkan PKS")} onBuka={setBuka} pilih={buka} />
                </>
              ) : (
                <Bagian judul={JUDUL[t.tab]} catatan={CATATAN[t.tab]} nada="sky" baris={d.baris ?? []} onBuka={setBuka} pilih={buka} />
              )}
                </DuaKolom>
              )}
            </>
          )}
        </TabsContent>
      ))}
      {(["belum-lengkap", "lolos-tanpa-forum"] as const).map((f) => {
        const s = sumber[f];
        if (!s) return null;
        const Daftar = f === "belum-lengkap" ? DaftarBelumLengkap : DaftarLolos;
        return (
          <TabsContent key={f} value={f}>
            <DuaKolom lebarDaftar panel={lebar && tab === f ? (
              <RencanaPanel key={`${f}-${buka ?? "kosong"}`} tab={s.tab.tab} id={buka} bolehAksi={s.tab.bolehAksi}
                onBerubah={() => setSegar((x) => x + 1)} />
            ) : null}>
              <Daftar tab={s.tab.tab} cakupan={s.cakupan} onBuka={setBuka} segar={segar} />
            </DuaKolom>
          </TabsContent>
        );
      })}
      {bottomLine && (
        <TabsContent value="bottomline"><BottomLinePanel /></TabsContent>
      )}
      {bottomLine && (
        <TabsContent value="portofolio"><PortofolioPanel /></TabsContent>
      )}
      {aktif && !lebar && (
        <RencanaDialog key={`${aktif.tab}-${buka ?? "tutup"}`} tab={aktif.tab} id={buka} bolehAksi={aktif.bolehAksi}
          onClose={() => setBuka(null)} onBerubah={() => berubah(aktif.tab)} />
      )}
    </Tabs>
  );
}

const JUDUL: Partial<Record<TabKso, string>> = {
  saya: "Rencana KSO saya",
  direksi: "Menunggu putusan Direksi",
  penawaran: "Mandat berlaku — siap diterbitkan penawarannya (cadangan Sekretariat)",
  teknik: "PKS ditandatangani — jadwalkan pemasangan",
};
const CATATAN: Partial<Record<TabKso, string>> = {
  direksi: "Batas putusan 22.00 WIB hari forum. Setuju/Bersyarat wajib menetapkan mandat negosiasi.",
  penawaran: "Hanya mandat yang masih berlaku. Penawaran di bawah harga lantai ditolak sistem.",
  teknik: "Serah terima wajib nomor seri; verifikasi bulan ke-6 terjadwal otomatis.",
};

// Pita ringkasan (pola dashboard Direktur): satu kartu bersekat, angka besar + keterangan alur.
function PitaAlur({ r }: { r: Ringkasan }) {
  const isi: [string, number | string, string, string][] = [
    ["Menunggu HOD", r.menunggu_hod, "jalur cepat", "text-amber-700 dark:text-amber-400"],
    ["Antre forum", r.menunggu_forum, "Selasa / Kamis 16.00", "text-amber-700 dark:text-amber-400"],
    ["Menunggu Direksi", r.menunggu_direksi, "putus sebelum 22.00", "text-amber-700 dark:text-amber-400"],
    ["Siap penawaran", r.siap_penawaran, "mandat sudah ada", "text-emerald-700 dark:text-emerald-400"],
    ["Ditahan", r.ditahan, "data kurang", "text-red-700 dark:text-red-400"],
  ];
  return (
    <div className={cn("bg-card grid grid-cols-2 overflow-hidden rounded-xl border shadow-[var(--shadow-card)] sm:grid-cols-3",
      r.capex_disetujui == null ? "lg:grid-cols-5" : "lg:grid-cols-6")}>
      {isi.map(([l, v, ket, warna]) => (
        <div key={l} className="border-border border-b p-3 sm:p-4 lg:border-r lg:border-b-0">
          <div className={cn("text-2xl font-bold tabular-nums", Number(v) === 0 ? "text-muted-foreground" : warna)}>{v}</div>
          <div className="mt-0.5 text-sm font-medium">{l}</div>
          <div className="text-muted-foreground text-xs">{ket}</div>
        </div>
      ))}
      {/* capex = HPP alat: tidak dikirim API untuk AM / HOD Sales / Admin Sales / Teknik (10 Nov) */}
      {r.capex_disetujui != null && (
        <div className="border-border col-span-2 border-b p-3 sm:col-span-1 sm:p-4 lg:border-b-0">
          <div className="text-2xl font-bold tabular-nums">{rpJt(Number(r.capex_disetujui))}</div>
          <div className="mt-0.5 text-sm font-medium">Capex disetujui</div>
          <div className="text-muted-foreground text-xs">jalur cepat + Direksi</div>
        </div>
      )}
    </div>
  );
}

/** ≥ 1024 px: detail di panel kanan; lebih sempit: dialog. */
function useLayarLebar() {
  return useSyncExternalStore(
    (ubah) => { const m = window.matchMedia("(min-width: 1024px)"); m.addEventListener("change", ubah); return () => m.removeEventListener("change", ubah); },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

function DuaKolom({ panel, children, lebarDaftar = false }: { panel: React.ReactNode; children: React.ReactNode; lebarDaftar?: boolean }) {
  return (
    <div className={cn("grid gap-5 lg:items-start",
      lebarDaftar ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]")}>
      <div className="space-y-6">{children}</div>
      {panel && <aside className="hidden lg:sticky lg:top-4 lg:block">{panel}</aside>}
    </div>
  );
}

export function PolaGerbang({ pola }: { pola: string | null }) {
  if (!pola) return null;
  return (
    <span className="inline-flex gap-0.5" aria-label={`gerbang ${pola}`}>
      {pola.split("").map((c, i) => (
        <span key={i} className={cn("inline-block size-4 rounded-[3px] text-center text-[10px] font-bold leading-4", GERBANG_SOLID[POLA_STATUS[c] ?? "belum"])}>{i + 1}</span>
      ))}
    </span>
  );
}

function Bagian({ judul, catatan, baris, onBuka, pilih }: {
  judul?: string; catatan?: string; nada?: "sky" | "amber"; baris: BarisAntrean[]; onBuka: (id: number) => void; pilih: number | null;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">{judul} <span className="text-muted-foreground text-sm font-normal tabular-nums">{baris.length}</span></h2>
        {catatan && <p className="text-muted-foreground text-xs">{catatan}</p>}
      </div>
      {baris.length === 0 ? <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">Tidak ada yang menunggu di sini.</p> : (
        <ul className="space-y-2">
          {baris.map((b) => (
            <li key={`${b.antrean}-${b.id}`}>
              <button type="button" onClick={() => onBuka(b.id)} aria-current={pilih === b.id || undefined}
                className={cn("bg-card w-full rounded-xl border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary-dark",
                  pilih === b.id && "border-primary-dark ring-primary-dark ring-1")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{b.faskes_nama}{b.cabang ? <span className="text-muted-foreground font-normal"> — {b.cabang}</span> : null}
                    {b.faskes_baru && <BadgeFaskesBaru kota={b.faskes_kota} className="ml-1.5 align-middle" />}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">{b.nomor ?? `D${b.id}`}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                  <PolaGerbang pola={b.pola_gerbang} />
                  <span className="text-muted-foreground">{b.alat_nama}</span>
                  {b.capex != null && <span className="text-muted-foreground tabular-nums">{rpJt(b.capex)}</span>}
                  <LabelStatus status={b.status} />
                  {b.zona && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", ZONA_CLS[b.zona])}>
                      {LABEL_ZONA[b.zona]}{b.gpm_deal != null ? ` · ${persen(b.gpm_deal)}` : ""}
                    </span>
                  )}
                </div>
                {(b.batas || b.volume_terverifikasi === true) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs">
                    {b.batas && <span className="font-medium text-amber-700 dark:text-amber-400">Batas {waktu(b.batas)}</span>}
                    {b.volume_terverifikasi === true && <span className="text-emerald-700 dark:text-emerald-400">Volume terverifikasi</span>}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Agenda({ baris, onBuka }: { baris: BarisAgenda[]; onBuka: (id: number) => void; pilih?: number | null }) {
  const forum = [...new Map(baris.map((b) => [b.forum_id, b])).values()];
  if (forum.length === 0) return <EmptyState title="Belum ada forum" description="Agenda terbit otomatis pukul 14.00 hari Selasa/Kamis." />;
  return (
    <section className="space-y-3">
      {forum.map((f) => {
        const isi = baris.filter((b) => b.forum_id === f.forum_id && b.rencana_id);
        return (
          <div key={f.forum_id} className="bg-card rounded-xl border p-3 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Forum {f.hari}, {f.tanggal}</span>
              <span className="text-muted-foreground text-xs">{f.mode === "portofolio" || isi.length === 0 ? "Tinjauan portofolio" : `${isi.filter((x) => x.jenis === "A").length} Agenda A`}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {isi.map((b) => (
                <li key={`${b.jenis}-${b.rencana_id}`}>
                  <button type="button" onClick={() => onBuka(b.rencana_id!)} className="hover:bg-accent flex w-full flex-wrap items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm">
                    {/* nomor tampil = urutan di dalam jenisnya (urut DB untuk Agenda B dimulai 101) */}
                    <span><b>{b.jenis}{isi.filter((x) => x.jenis === b.jenis).indexOf(b) + 1}</b> · {b.faskes_nama} · {b.alat_nama} · {rpJt(b.capex)}</span>
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
