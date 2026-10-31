"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { kirim, rp, rpJt, waktu } from "./types";

// F172 Bottom Line Alat — model GPM (Pedoman Komite KSO Forum v01, 27 Okt 2026).
//   GPM = 1 − (reagen/tes + (reagen tetap + QC)/volume + HPP/(tenor × volume)) ÷ harga/tes
// Zona: ≥ 55% AM · 50–55% dua HOD · 45–50% Forum → Direktur · < 45% Direktur. HD tanpa zona.
// Data & izin dari apps/api/src/repo/kso-komite-bottomline.ts; rumus di bawah = salinan untuk peta
// GPM dan hitung langsung saat mengetik (API menghitung ulang saat simpan). Real bottom dimuat dari
// endpoint terpisah HANYA bila izin realLihat/realCatat — tak pernah ikut data halaman biasa.

type Zona = "am" | "hod" | "forum" | "direktur";
interface PerZona { am: number | null; hod: number | null; forum: number | null }
interface Unit { faskes: string | null; skema: string; status: "Jalan" | "Idle" | "Tanpa faskes"; bulan_aktif: number; omzet_bln: number; hpp_sn: number | null }
interface Keputusan { volume: number | null; lantai_final: number | null; keputusan: string | null; catatan: string; diputus_at: string; diputus_nama: string | null }
interface Baris {
  model_key: string; kelompok: string; jenis: string; model: string; satuan: "tes" | "tindakan"; hd: boolean;
  unit: number; idle: number; tanpa_faskes: number; omzet_unit_bln: number | null;
  hpp: number | null; hpp_aset: number | null; hpp_tgl: string | null; hpp_median: number | null; hpp_sumber: string; unit_ber_hpp: number;
  rupiah_per_tes: number | null; rupiah_per_tes_sumber: string | null; volume: number | null; volume_acuan: number | null;
  biaya_per_tes: number | null; biaya_tetap_bulan: number; qc_bulan: number; biaya_sumber: string | null; biaya_keyakinan: string | null;
  harga_pasar_min: number | null; harga_pasar_max: number | null; harga_acuan: number | null; harga_acuan_sumber: string | null;
  biaya_di_volume: number | null; cicilan_di_volume: number | null;
  gpm_realisasi: number | null; zona_realisasi: Zona | null; gpm: number | null; zona: Zona | null;
  volume_min: PerZona | null; harga_min: PerZona | null; hpp_maks: number | null; bottom: number | null; bottom_final: number | null;
  grid_volume: number[]; grid_harga: number[]; keputusan: Keputusan | null; units: Unit[];
}
interface Jenis { jenis: string; kelompok: string; satuan: string; rupiah_per_tes_manual: string | null; margin_kotor: string | null }
interface Izin { putus: boolean; angka: boolean; realLihat: boolean; realCatat: boolean }
interface Param { tenor: number; gpm_am: number; gpm_hod: number; gpm_forum: number; diubah_at: string | null }
interface Data { izin: Izin; parameter: Param; periode: { dari: string; sampai: string } | null; jenis: Jenis[]; baris: Baris[] }
interface DukunganBaris {
  id: number; model_key: string; jenis_dukungan: "promo" | "prinsipal" | "qc_gratis"; beli_x: number | null; gratis_y: number | null;
  berlaku_mulai: string; berlaku_sampai: string | null; catatan: string | null; dicatat_nama: string | null; berlaku: boolean;
}
interface Real {
  izin: { realLihat: boolean; realCatat: boolean }; dukungan: DukunganBaris[];
  model: { model_key: string; hpp_real: number | null; qc_real: number; gpm: number | null; zona: Zona | null; volume_min: PerZona | null; bottom: number | null }[];
}

const KEPUTUSAN = ["Setuju", "Ubah", "Tahan penempatan baru", "Tarik / relokasi", "Diskusikan"];
// chip zona: warna/10 + teks warna-700 (bg-muted tak terlihat di mode terang — standar UI)
const ZONA: Record<Zona, [string, string, string]> = {
  am: ["AM", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", "bg-emerald-500/25"],
  hod: ["2 HOD", "bg-sky-500/10 text-sky-700 dark:text-sky-400", "bg-sky-500/25"],
  forum: ["Forum", "bg-amber-500/10 text-amber-700 dark:text-amber-400", "bg-amber-500/25"],
  direktur: ["Direktur", "bg-red-500/10 text-red-700 dark:text-red-400", "bg-red-500/20"],
};
const NETRAL = "bg-slate-500/10 text-slate-700 dark:text-slate-300";
const DUKUNGAN: Record<DukunganBaris["jenis_dukungan"], string> = { promo: "Promo beli X gratis Y", prinsipal: "Alat didukung prinsipal (HPP 0)", qc_gratis: "QC gratis dari prinsipal" };
const SELECT_CLS = "rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50";

const angka = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("id-ID"));
const persen = (g: number | null | undefined) => (g == null ? "—" : `${(g * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const bulanId = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
const hariIni = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const post = (jenis: string, body: Record<string, unknown>) =>
  kirim(`/api/kso-komite/bottom-line/${jenis}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- rumus (salinan API) ----
interface Angka { reagen: number | null; tetap: number; qc: number; hpp: number | null }
function gpmDi(a: Angka, harga: number, v: number, tenor: number): number | null {
  if (a.reagen == null || a.hpp == null || v <= 0 || harga <= 0) return null;
  return 1 - (a.reagen + (a.tetap + a.qc) / v + a.hpp / (tenor * v)) / harga;
}
function hargaMinDi(a: Angka, v: number | null, g: number, tenor: number): number | null {
  if (a.reagen == null || a.hpp == null || !v || v <= 0) return null;
  return (a.reagen + (a.tetap + a.qc) / v + a.hpp / (tenor * v)) / (1 - g);
}
function volumeMinDi(a: Angka, harga: number | null, g: number, tenor: number): number | null {
  if (a.reagen == null || a.hpp == null || !harga) return null;
  const sisa = harga * (1 - g) - a.reagen;
  return sisa <= 0 ? null : (a.tetap + a.qc + a.hpp / tenor) / sisa;
}
const zonaDari = (g: number | null, p: Param): Zona | null =>
  g == null ? null : g >= p.gpm_am ? "am" : g >= p.gpm_hod ? "hod" : g >= p.gpm_forum ? "forum" : "direktur";

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>{children}</span>;
}
function PillZona({ z, hd }: { z: Zona | null; hd?: boolean }) {
  if (hd) return <Pill cls={NETRAL}>Kalkulator HD</Pill>;
  return z ? <Pill cls={ZONA[z][1]}>{ZONA[z][0]}</Pill> : <Pill cls={NETRAL}>Belum ada data</Pill>;
}

export function BottomLinePanel() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kelompok, setKelompok] = useState("");
  const [status, setStatus] = useState("");
  const [cari, setCari] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const muat = useCallback(() => {
    kirim<Data>("/api/kso-komite/bottom-line").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const kelompokList = useMemo(() => [...new Set((d?.baris ?? []).map((b) => b.kelompok))], [d]);
  const tampil = useMemo(() => (d?.baris ?? []).filter((b) => {
    if (kelompok && b.kelompok !== kelompok) return false;
    const q = cari.trim().toLowerCase();
    if (q && !(b.model.toLowerCase().includes(q) || b.jenis.toLowerCase().includes(q) || b.units.some((u) => (u.faskes ?? "").toLowerCase().includes(q)))) return false;
    if (status === "belum" && b.keputusan?.keputusan) return false;
    if (status === "sudah" && !b.keputusan?.keputusan) return false;
    if (status === "direktur" && b.zona_realisasi !== "direktur") return false;
    if (status === "idle" && b.idle === 0) return false;
    if (status === "tanpa-hpp" && b.hpp != null) return false;
    return true;
  }), [d, kelompok, status, cari]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const p = d.parameter;
  const aktif = d.baris.find((b) => b.model_key === buka) ?? null;
  const stat: [string, string | number][] = [
    ["Model alat", d.baris.length],
    ["Unit di populasi", d.baris.reduce((s, b) => s + b.unit, 0)],
    ["Unit idle 12 bln", d.baris.reduce((s, b) => s + b.idle, 0)],
    ["Realisasi di zona Direktur", d.baris.filter((b) => b.zona_realisasi === "direktur").length],
    ["Model tanpa HPP", d.baris.filter((b) => b.hpp == null).length],
    ["Sudah diputus", `${d.baris.filter((b) => b.keputusan?.keputusan).length} / ${d.baris.length}`],
  ];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Satu ukuran untuk semua alat: <b>GPM deal</b> — margin kotor setelah reagen, QC, dan cicilan alat {p.tenor} bulan — di harga dan volume yang AM bawa.
        Angka di sini = <b>bottom standar</b> (HPP penuh) untuk Forum, HOD, dan AM.
        {d.periode && <> Omzet {bulanId(d.periode.dari)}–{bulanId(d.periode.sampai)}; angka belum diaudit.</>}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stat.map(([l, v]) => (
          <div key={l} className="bg-card rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{l}</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{typeof v === "number" ? angka(v) : v}</div>
          </div>
        ))}
      </div>
      <Parameter p={p} boleh={d.izin.putus} onBerubah={muat} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">Kelompok
          <select className={SELECT_CLS} value={kelompok} onChange={(e) => setKelompok(e.target.value)}>
            <option value="">Semua ({d.baris.length})</option>
            {kelompokList.map((k) => <option key={k} value={k}>{k} ({d.baris.filter((b) => b.kelompok === k).length})</option>)}
          </select>
        </label>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">Status
          <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua status</option>
            <option value="belum">Belum diputus</option>
            <option value="sudah">Sudah diputus</option>
            <option value="direktur">Realisasi di zona Direktur (&lt; {persen(p.gpm_forum)})</option>
            <option value="idle">Ada unit idle</option>
            <option value="tanpa-hpp">HPP belum tercatat</option>
          </select>
        </label>
        <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs sm:max-w-xs">Cari model / faskes
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="mis. Z52, Muslimat" />
        </label>
      </div>

      {tampil.length === 0 ? <EmptyState title="Tidak ada model yang cocok" description="Ubah filter atau kata cari." /> : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="border-b text-left text-xs">
              <th className="p-2">Model</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">HPP</th>
              <th className="p-2 text-right">Harga pasar</th><th className="p-2 text-right">Volume historis</th>
              <th className="p-2 text-right">Reagen + QC / tes</th><th className="p-2">GPM realisasi</th>
              <th className="p-2 text-right">Vol. min @{persen(p.gpm_forum)}</th><th className="p-2 text-right">Bottom standar</th>
              <th className="p-2 text-right">Bottom line</th><th className="p-2">Keputusan</th>
            </tr></thead>
            <tbody>
              {tampil.map((b, i) => (
                <BarisModel key={b.model_key} b={b} judul={i === 0 || tampil[i - 1].kelompok !== b.kelompok} onBuka={setBuka} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        GPM realisasi = di Rp/tes dan volume historis OS. Volume historis = median omzet per unit per bulan (unit yang jalan) ÷ Rp/tes jenis; omzet faskes per jenis dibagi rata ke unit sejenis.
        Volume minimum dihitung di harga acuan (harga pasar terendah, atau realisasi bila harga pasar belum diisi). Bottom standar = harga minimum di batas zona Forum pada volume acuan, HPP penuh.
        HPP = HPP standar Finance; bila kosong, aset tetap ALAT KSO yang nomor serinya cocok. Hemodialisa tidak memakai zona (Kalkulator HD, selalu Direktur).
      </p>
      {d.izin.angka && <AcuanJenis jenis={d.jenis} onBerubah={muat} />}
      {aktif && <DetailModel key={aktif.model_key} b={aktif} p={p} izin={d.izin} onClose={() => setBuka(null)} onBerubah={muat} />}
    </div>
  );
}

function BarisModel({ b, judul, onBuka }: { b: Baris; judul: boolean; onBuka: (k: string) => void }) {
  const satuan = b.hd ? "tindakan" : "tes";
  return (
    <>
      {judul && <tr className="border-b"><td colSpan={11} className="bg-accent/40 p-2 text-xs font-bold uppercase tracking-wide">{b.kelompok}</td></tr>}
      <tr className="hover:bg-accent/30 cursor-pointer border-b last:border-0" tabIndex={0} onClick={() => onBuka(b.model_key)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBuka(b.model_key); } }}>
        <td className="p-2"><div className="font-semibold">{b.model}</div><div className="text-muted-foreground text-xs">{b.jenis}</div></td>
        <td className="p-2 text-right tabular-nums">{b.unit}
          {b.idle > 0 && <div className="text-xs text-red-700 dark:text-red-400">{b.idle} idle</div>}
          {b.tanpa_faskes > 0 && <div className="text-muted-foreground text-xs">{b.tanpa_faskes} tanpa faskes</div>}
        </td>
        <td className="p-2 text-right tabular-nums">{rpJt(b.hpp)}{b.hpp == null ? <div className="text-xs text-amber-700 dark:text-amber-400">belum ada</div> : b.hpp_sumber === "HPP standar Finance" && <div className="text-muted-foreground text-xs">Finance</div>}</td>
        <td className="p-2 text-right tabular-nums">{b.harga_pasar_min ? `${angka(b.harga_pasar_min)}${b.harga_pasar_max && b.harga_pasar_max !== b.harga_pasar_min ? `–${angka(b.harga_pasar_max)}` : ""}` : "—"}</td>
        <td className="p-2 text-right tabular-nums">{b.volume ? `${angka(b.volume)} ${satuan}` : "—"}</td>
        <td className="p-2 text-right tabular-nums">{angka(b.biaya_di_volume ?? b.biaya_per_tes)}</td>
        <td className="p-2"><div className="flex items-center gap-1.5"><PillZona z={b.zona_realisasi} hd={b.hd} />{!b.hd && <span className="text-xs tabular-nums">{persen(b.gpm_realisasi)}</span>}</div></td>
        <td className="p-2 text-right tabular-nums">{b.hd ? "—" : b.volume_min?.forum ? angka(b.volume_min.forum) : b.hpp != null && b.harga_acuan ? <span className="text-xs text-red-700 dark:text-red-400">tak tercapai</span> : "—"}</td>
        <td className="p-2 text-right tabular-nums">{angka(b.bottom)}</td>
        <td className="text-primary p-2 text-right font-bold tabular-nums">{b.bottom_final ? angka(b.bottom_final) : "—"}</td>
        <td className="p-2">{b.keputusan?.keputusan
          ? <Pill cls="bg-violet-500/10 text-violet-700 dark:text-violet-400">{b.keputusan.keputusan}</Pill>
          : <Pill cls={NETRAL}>Belum diputus</Pill>}</td>
      </tr>
    </>
  );
}

function Parameter({ p, boleh, onBerubah }: { p: Param; boleh: boolean; onBerubah: () => void }) {
  const pc = (x: number) => String(Math.round(x * 1000) / 10);
  const [tenor, setTenor] = useState(String(p.tenor));
  const [am, setAm] = useState(pc(p.gpm_am)), [hod, setHod] = useState(pc(p.gpm_hod)), [forum, setForum] = useState(pc(p.gpm_forum));
  const [pesan, setPesan] = useState<string | null>(null);
  const simpan = async () => {
    setPesan(null);
    try {
      await post("parameter", { tenor: Number(tenor), gpm_am: Number(am) / 100, gpm_hod: Number(hod) / 100, gpm_forum: Number(forum) / 100 });
      setPesan("Parameter tersimpan."); onBerubah();
    } catch (e) { setPesan((e as Error).message); }
  };
  const isian: [string, string, (s: string) => void][] = [["Tenor (bln)", tenor, setTenor], ["Zona AM ≥ %", am, setAm], ["Zona 2 HOD ≥ %", hod, setHod], ["Zona Forum ≥ %", forum, setForum]];
  return (
    <div className="bg-card flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border p-3">
      <code className="text-xs">GPM = 1 − (reagen/tes + (reagen tetap + QC)/volume + HPP/(tenor × volume)) ÷ harga/tes</code>
      {isian.map(([l, v, set]) => (
        <label key={l} className="text-muted-foreground flex items-center gap-1.5 text-xs">{l}
          <Input type="number" step="1" className="h-8 w-20 tabular-nums" value={v} disabled={!boleh} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      {boleh && <Button size="sm" onClick={simpan}>Simpan parameter</Button>}
      {pesan && <span className="text-xs">{pesan}</span>}
      <div className="flex w-full flex-wrap gap-2 text-xs">
        {(Object.keys(ZONA) as Zona[]).map((z) => <Pill key={z} cls={ZONA[z][1]}>{ZONA[z][0]}{z === "am" ? ` ≥ ${am}%` : z === "hod" ? ` ${hod}–${am}%` : z === "forum" ? ` ${forum}–${hod}%` : ` < ${forum}%`}</Pill>)}
      </div>
    </div>
  );
}

function DetailModel({ b, p, izin, onClose, onBerubah }: { b: Baris; p: Param; izin: Izin; onClose: () => void; onBerubah: () => void }) {
  const d = b.keputusan;
  const satuan = b.hd ? "tindakan" : "tes";
  // keputusan Direktur
  const [vol, setVol] = useState(String(d?.volume ?? b.volume ?? ""));
  const [final, setFinal] = useState(d?.lantai_final ? String(d.lantai_final) : "");
  const [kep, setKep] = useState(d?.keputusan ?? "");
  const [cat, setCat] = useState(d?.catatan ?? "");
  // angka Finance
  const fin = b.hpp_sumber === "HPP standar Finance";
  const [hpp, setHpp] = useState(fin && b.hpp ? String(b.hpp) : "");
  const [reagen, setReagen] = useState(b.biaya_per_tes == null ? "" : String(b.biaya_per_tes));
  const [tetap, setTetap] = useState(String(b.biaya_tetap_bulan ?? 0));
  const [qc, setQc] = useState(String(b.qc_bulan ?? 0));
  const [pmin, setPmin] = useState(b.harga_pasar_min ? String(b.harga_pasar_min) : "");
  const [pmax, setPmax] = useState(b.harga_pasar_max ? String(b.harga_pasar_max) : "");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  // angka yang sedang diketik ikut ke peta & tiga angka forum
  const a: Angka = { reagen: reagen === "" ? null : Number(reagen), tetap: Number(tetap) || 0, qc: Number(qc) || 0, hpp: Number(hpp) || b.hpp_aset };
  const volU = Number(vol) || b.volume;
  const harga = Number(pmin) || b.rupiah_per_tes;
  const zonaBaris: [Zona, number][] = [["am", p.gpm_am], ["hod", p.gpm_hod], ["forum", p.gpm_forum]];
  const bottom = hargaMinDi(a, volU, p.gpm_forum, p.tenor);
  const hppMaks = a.reagen != null && harga && volU ? Math.max(0, (harga * (1 - p.gpm_forum) - (a.reagen + (a.tetap + a.qc) / volU)) * p.tenor * volU) : null;

  const simpan = async (jenis: string, body: Record<string, unknown>, ok: string) => {
    setSibuk(true); setPesan(null);
    try { await post(jenis, body); setPesan(ok); onBerubah(); } catch (e) { setPesan((e as Error).message); } finally { setSibuk(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b.model} <span className="text-muted-foreground font-normal">· {b.jenis}</span></DialogTitle>
          <DialogDescription>
            {b.unit} unit{b.idle ? ` · ${b.idle} idle` : ""}{b.tanpa_faskes ? ` · ${b.tanpa_faskes} tanpa faskes` : ""} · realisasi {rp(b.rupiah_per_tes)}/{satuan}
            {b.hd ? "" : ` · GPM realisasi ${persen(b.gpm_realisasi)}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 lg:grid-cols-2">
          <section className="min-w-0 space-y-4">
            {b.hd ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                Hemodialisa tidak memakai zona GPM: tarif per tindakan tidak cukup membayar mesin dalam {p.tenor} bulan. Pakai Kalkulator Investasi KSO HD
                (margin per tindakan ≥ 15% sepanjang tenor, ≥ 400 tindakan per site per bulan, payback ≤ 40 bulan) — selalu diputus Direktur.
              </p>
            ) : (
              <div className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-semibold uppercase">Angka forum (bottom standar)</h3>
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs">
                    <th className="p-1.5">Zona</th>
                    <th className="p-1.5 text-right">Harga min @ {angka(volU)} {satuan}/bln</th>
                    <th className="p-1.5 text-right">Volume min @ {rp(harga)}</th>
                  </tr></thead>
                  <tbody>
                    {zonaBaris.map(([z, g]) => {
                      const vm = volumeMinDi(a, harga, g, p.tenor);
                      return (
                        <tr key={z} className="border-b last:border-0">
                          <td className="p-1.5"><Pill cls={ZONA[z][1]}>{ZONA[z][0]} ≥ {persen(g)}</Pill></td>
                          <td className="p-1.5 text-right tabular-nums">{angka(hargaMinDi(a, volU, g, p.tenor))}</td>
                          <td className="p-1.5 text-right tabular-nums">{vm ? angka(vm) : a.hpp != null && harga ? <span className="text-xs text-red-700 dark:text-red-400">tak tercapai</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-sm">HPP alat maksimal @ {persen(p.gpm_forum)} di harga & volume ini: <b className="tabular-nums">{rpJt(hppMaks)}</b>
                  <span className="text-muted-foreground text-xs"> (bahan negosiasi ke prinsipal)</span></p>
                <p className="text-muted-foreground text-xs">Harga acuan: {Number(pmin) ? "harga pasar terendah" : b.harga_acuan_sumber ?? "—"}. HPP: {b.hpp_sumber}
                  {b.hpp_aset != null && fin ? ` (aset tetap ${rpJt(b.hpp_aset)})` : ""} · {b.unit_ber_hpp}/{b.unit} unit cocok SN.
                  {" "}Biaya reagen: {b.biaya_sumber ?? "belum diisi"}{b.biaya_keyakinan ? ` · keyakinan ${b.biaya_keyakinan}` : ""}.</p>
              </div>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <h3 className="text-muted-foreground text-xs font-semibold uppercase">Keputusan Direktur</h3>
              <div className="grid grid-cols-2 gap-3">
                <Isian label={`Volume acuan (${satuan}/unit/bln)`} v={vol} set={setVol} step="10" off={!izin.putus} />
                <Isian label={`Bottom line final per ${satuan} (kosong = bottom standar)`} v={final} set={setFinal} step="100" off={!izin.putus} />
                <div className="grid gap-1">
                  <Label className="text-xs">Keputusan</Label>
                  <select className={SELECT_CLS} value={kep} disabled={!izin.putus} onChange={(e) => setKep(e.target.value)}>
                    <option value="">— pilih —</option>
                    {KEPUTUSAN.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Bottom standar @ {persen(p.gpm_forum)}</Label>
                  <div className="text-primary py-1.5 text-lg font-extrabold tabular-nums">{b.hd ? "—" : angka(bottom)}</div>
                </div>
                <div className="col-span-2 grid gap-1">
                  <Label className="text-xs">Catatan untuk Komite</Label>
                  <Input value={cat} disabled={!izin.putus} onChange={(e) => setCat(e.target.value)} placeholder="mis. tolak di bawah volume minimum; RS kecil ditawari alat yang lebih murah" />
                </div>
              </div>
              {izin.putus && (
                <Button size="sm" disabled={sibuk} onClick={() => simpan("keputusan", {
                  model_key: b.model_key, volume: vol === "" || Number(vol) === b.volume ? null : Number(vol),
                  lantai_final: final === "" ? null : Number(final), keputusan: kep || null, catatan: cat,
                }, "Keputusan tersimpan.")}>Simpan keputusan</Button>
              )}
              {d && <p className="text-muted-foreground text-xs">Terakhir diputus {waktu(d.diputus_at)}{d.diputus_nama ? ` oleh ${d.diputus_nama}` : ""}.</p>}
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <h3 className="text-muted-foreground text-xs font-semibold uppercase">Angka Finance {izin.angka ? "" : "(baca saja)"}</h3>
              <div className="grid grid-cols-2 gap-3">
                <Isian label={`HPP standar (kosong = aset tetap ${rpJt(b.hpp_aset)})`} v={hpp} set={setHpp} step="100000" off={!izin.angka} />
                <Isian label={`Reagen per ${satuan} (Rp)`} v={reagen} set={setReagen} step="100" off={!izin.angka} />
                <Isian label="Reagen tetap per bulan — kalibrasi dsb. (Rp)" v={tetap} set={setTetap} step="10000" off={!izin.angka} />
                <Isian label="QC per bulan (Rp)" v={qc} set={setQc} step="10000" off={!izin.angka} />
                <Isian label={`Harga pasar terendah per ${satuan}`} v={pmin} set={setPmin} step="100" off={!izin.angka} />
                <Isian label={`Harga pasar tertinggi per ${satuan}`} v={pmax} set={setPmax} step="100" off={!izin.angka} />
              </div>
              {izin.angka && (
                <Button size="sm" variant="outline" disabled={sibuk} onClick={() => simpan("angka", {
                  model_key: b.model_key, hpp_standar: hpp || null, biaya_per_tes: reagen === "" ? null : Number(reagen),
                  biaya_tetap_bulan: Number(tetap) || 0, qc_bulan: Number(qc) || 0, harga_pasar_min: pmin || null, harga_pasar_max: pmax || null,
                  sumber: "isian Finance", keyakinan: "High",
                }, "Angka Finance tersimpan.")}>Simpan angka</Button>
              )}
            </div>
            {pesan && <p className="text-sm">{pesan}</p>}
            {(izin.realLihat || izin.realCatat) && <RealBottom b={b} izin={izin} />}
          </section>

          <section className="min-w-0 space-y-3">
            {!b.hd && <PetaGpm b={b} a={a} p={p} vol={volU} harga={harga} />}
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">Unit ({b.unit})</h3>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left"><th className="p-1.5">Faskes</th><th className="p-1.5">Skema</th><th className="p-1.5">Status</th><th className="p-1.5 text-right">HPP SN</th><th className="p-1.5 text-right">Omzet/bln</th></tr></thead>
                <tbody>
                  {b.units.map((u, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-1.5">{u.faskes ?? "—"}</td>
                      <td className="p-1.5">{u.skema.replace("_", " ")}</td>
                      <td className="p-1.5">{u.status === "Jalan" ? "Jalan" : <Pill cls={u.status === "Idle" ? ZONA.direktur[1] : NETRAL}>{u.status}</Pill>}</td>
                      <td className="p-1.5 text-right tabular-nums">{rpJt(u.hpp_sn)}</td>
                      <td className="p-1.5 text-right tabular-nums">{rpJt(u.omzet_bln)}{u.bulan_aktif < 12 && <div className="text-muted-foreground">{u.bulan_aktif} bln</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Peta GPM: volume × harga, warna per zona — alat baca utama forum (Pedoman v01). */
function PetaGpm({ b, a, p, vol, harga }: { b: Baris; a: Angka; p: Param; vol: number | null; harga: number | null }) {
  if (b.grid_harga.length === 0 || a.reagen == null || a.hpp == null)
    return <p className="text-muted-foreground text-xs">Peta GPM butuh HPP, biaya reagen, dan harga pasar / realisasi.</p>;
  return (
    <div className="space-y-1">
      <h3 className="text-muted-foreground text-xs font-semibold uppercase">Peta GPM — volume × harga</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><th className="p-1 text-left">Vol \ Rp</th>{b.grid_harga.map((h) => <th key={h} className="p-1 text-right tabular-nums">{angka(h)}</th>)}</tr></thead>
          <tbody>
            {b.grid_volume.map((v) => (
              <tr key={v}>
                <th className="p-1 text-left tabular-nums">{angka(v)}</th>
                {b.grid_harga.map((h) => {
                  const g = gpmDi(a, h, v, p.tenor), z = zonaDari(g, p);
                  return <td key={h} className={cn("p-1 text-right tabular-nums", z ? ZONA[z][2] : "")}>{persen(g)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">Acuan sekarang: {angka(vol)} {b.hd ? "tindakan" : "tes"}/bln di {rp(harga)} → GPM {persen(vol && harga ? gpmDi(a, harga, vol, p.tenor) : null)}.</p>
    </div>
  );
}

/** Real bottom — dimuat terpisah dari /bottom-line/real; hanya izin realLihat (angka) / realCatat (catat dukungan). */
function RealBottom({ b, izin }: { b: Baris; izin: Izin }) {
  const [r, setR] = useState<Real | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [jenis, setJenis] = useState<DukunganBaris["jenis_dukungan"]>("promo");
  const [x, setX] = useState(""), [y, setY] = useState(""), [mulai, setMulai] = useState(hariIni()), [sampai, setSampai] = useState(""), [cat, setCat] = useState("");
  const muat = useCallback(() => {
    kirim<Real>("/api/kso-komite/bottom-line/real").then((x) => { setR(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);
  const simpan = async (body: Record<string, unknown>) => {
    setErr(null);
    try { await post("dukungan", body); muat(); } catch (e) { setErr((e as Error).message); }
  };
  const dukungan = (r?.dukungan ?? []).filter((d) => d.model_key === b.model_key);
  const m = r?.model.find((x) => x.model_key === b.model_key);
  return (
    <div className="space-y-2 rounded-md border border-violet-500/40 bg-violet-500/5 p-3">
      <h3 className="text-xs font-semibold uppercase text-violet-700 dark:text-violet-400">Real bottom — khusus Direktur</h3>
      <p className="text-muted-foreground text-xs">Tidak dibuka ke Forum maupun AM; tidak dikirim lewat WhatsApp dan tidak masuk risalah. Ditinjau tiap 3 bulan.</p>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {izin.realLihat && m && !b.hd && (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><div className="text-muted-foreground text-xs">HPP real</div><b className="tabular-nums">{rpJt(m.hpp_real)}</b></div>
          <div><div className="text-muted-foreground text-xs">QC real / bln</div><b className="tabular-nums">{angka(m.qc_real)}</b></div>
          <div><div className="text-muted-foreground text-xs">GPM real</div><b className="tabular-nums">{persen(m.gpm)}</b></div>
          <div><div className="text-muted-foreground text-xs">Real bottom @ Forum</div><b className="tabular-nums">{angka(m.bottom)}</b></div>
        </div>
      )}
      {izin.realLihat && !m && <p className="text-muted-foreground text-xs">Belum ada dukungan yang berlaku untuk model ini — real bottom = bottom standar.</p>}
      {dukungan.length > 0 && (
        <ul className="space-y-1 text-sm">
          {dukungan.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{DUKUNGAN[d.jenis_dukungan]}{d.jenis_dukungan === "promo" ? ` (beli ${d.beli_x} gratis ${d.gratis_y})` : ""} · {d.berlaku_mulai}{d.berlaku_sampai ? ` s/d ${d.berlaku_sampai}` : " s/d dicabut"}
                {!d.berlaku && <span className="text-muted-foreground"> · belum/tidak berlaku</span>}{d.catatan ? ` · ${d.catatan}` : ""}</span>
              {izin.realCatat && <Button size="sm" variant="outline" onClick={() => simpan({ cabut: d.id })}>Cabut</Button>}
            </li>
          ))}
        </ul>
      )}
      {izin.realCatat && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label className="text-xs">Jenis dukungan</Label>
            <select className={SELECT_CLS} value={jenis} onChange={(e) => setJenis(e.target.value as DukunganBaris["jenis_dukungan"])}>
              {(Object.keys(DUKUNGAN) as DukunganBaris["jenis_dukungan"][]).map((k) => <option key={k} value={k}>{DUKUNGAN[k]}</option>)}
            </select>
          </div>
          {jenis === "promo" && <><Isian label="Beli X" v={x} set={setX} step="1" /><Isian label="Gratis Y" v={y} set={setY} step="1" /></>}
          <div className="grid gap-1"><Label className="text-xs">Berlaku mulai</Label><Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></div>
          <div className="grid gap-1"><Label className="text-xs">Berlaku sampai (opsional)</Label><Input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></div>
          <div className="col-span-2 grid gap-1 sm:col-span-3"><Label className="text-xs">Catatan</Label><Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="mis. program Zybio Q4 2026" /></div>
          <div className="col-span-2 sm:col-span-3">
            <Button size="sm" onClick={() => simpan({ model_key: b.model_key, jenis_dukungan: jenis, beli_x: x || null, gratis_y: y || null, berlaku_mulai: mulai, berlaku_sampai: sampai || null, catatan: cat })}>Catat dukungan</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Isian({ label, v, set, step, off }: { label: string; v: string; set: (s: string) => void; step: string; off?: boolean }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} className="tabular-nums" value={v} disabled={off} onChange={(e) => set(e.target.value)} />
    </div>
  );
}

/** Acuan per jenis — Rp/tes pengganti (HD: tarif per tindakan) & margin kotor untuk taksiran biaya. Hanya Finance. */
function AcuanJenis({ jenis, onBerubah }: { jenis: Jenis[]; onBerubah: () => void }) {
  const [buka, setBuka] = useState(false);
  const [isi, setIsi] = useState<Record<string, { rpt: string; gm: string }>>(
    () => Object.fromEntries(jenis.map((j) => [j.jenis, { rpt: j.rupiah_per_tes_manual ?? "", gm: j.margin_kotor ?? "" }])));
  const [pesan, setPesan] = useState<string | null>(null);
  const simpan = async (j: string) => {
    setPesan(null);
    try {
      await post("jenis", { jenis: j, rupiah_per_tes_manual: isi[j].rpt || null, margin_kotor: isi[j].gm === "" ? null : Number(isi[j].gm) });
      setPesan(`${j} tersimpan.`); onBerubah();
    } catch (e) { setPesan((e as Error).message); }
  };
  return (
    <section className="bg-card rounded-lg border p-3">
      <button type="button" className="text-sm font-semibold" onClick={() => setBuka(!buka)}>{buka ? "▾" : "▸"} Acuan per jenis alat (Rp/tes pengganti &amp; margin kotor)</button>
      {buka && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">Rp/tes kosong = pakai realisasi OS. Isi untuk jenis yang realisasinya tidak bermakna (mis. Hemodialisa: tarif per tindakan).
            Margin kotor dipakai menaksir biaya reagen model yang belum punya isian: Rp/tes × (1 − margin).</p>
          {pesan && <p className="text-sm">{pesan}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b text-left text-xs"><th className="p-1.5">Jenis</th><th className="p-1.5">Rp/tes pengganti</th><th className="p-1.5">Margin kotor (0–0,99)</th><th /></tr></thead>
              <tbody>
                {jenis.map((j) => (
                  <tr key={j.jenis} className="border-b last:border-0">
                    <td className="p-1.5">{j.jenis} <span className="text-muted-foreground text-xs">· {j.kelompok}</span></td>
                    <td className="p-1.5"><Input type="number" className="h-8 w-32" value={isi[j.jenis]?.rpt ?? ""} onChange={(e) => setIsi({ ...isi, [j.jenis]: { ...isi[j.jenis], rpt: e.target.value } })} /></td>
                    <td className="p-1.5"><Input type="number" step="0.01" className="h-8 w-24" value={isi[j.jenis]?.gm ?? ""} onChange={(e) => setIsi({ ...isi, [j.jenis]: { ...isi[j.jenis], gm: e.target.value } })} /></td>
                    <td className="p-1.5"><Button size="sm" variant="outline" onClick={() => simpan(j.jenis)}>Simpan</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
