"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { kirim, rp, rpJt, waktu } from "./types";

// F172 Bottom Line Alat (migrasi 256) — lantai harga per tes per model alat. Direktur menetapkan,
// Komite memakai sebagai pegangan. Data & izin dari apps/api/src/repo/kso-komite-bottomline.ts;
// rumus di bawah = salinan untuk hitung langsung saat mengetik (API menghitung ulang saat simpan).

type Posisi = "aman" | "tipis" | "bawah" | "na";
interface Unit { faskes: string | null; skema: string; status: "Jalan" | "Idle" | "Tanpa faskes"; bulan_aktif: number; omzet_bln: number; hpp_sn: number | null }
interface Keputusan { hpp: number | null; volume: number | null; k: number | null; lantai_final: number | null; keputusan: string | null; catatan: string; diputus_at: string; diputus_nama: string | null }
interface Baris {
  model_key: string; kelompok: string; jenis: string; model: string; satuan: "tes" | "tindakan";
  unit: number; idle: number; tanpa_faskes: number; omzet_12: number | null; omzet_unit_bln: number | null;
  hpp: number | null; hpp_tgl: string | null; hpp_median: number | null; hpp_sumber: string; unit_ber_hpp: number;
  rupiah_per_tes: number | null; rupiah_per_tes_sumber: string | null; volume: number | null;
  biaya_per_tes: number | null; biaya_tetap_bulan: number; biaya_sumber: string | null; biaya_keyakinan: string | null; biaya_di_volume: number | null;
  lantai_usulan: number | null; lantai_hitung: number | null; lantai_final: number | null; posisi: Posisi; grid: number[];
  keputusan: Keputusan | null; units: Unit[];
}
interface Jenis { jenis: string; kelompok: string; satuan: string; rupiah_per_tes_manual: string | null; margin_kotor: string | null }
interface Data {
  bolehUbah: boolean; parameter: { k: number; bulan: number; penyangga_pct: number; diubah_at: string | null };
  periode: { dari: string; sampai: string } | null; jenis: Jenis[]; baris: Baris[];
}

const KEPUTUSAN = ["Setuju", "Ubah", "Tahan penempatan baru", "Tarik / relokasi", "Diskusikan"];
const POSISI: Record<Posisi, [string, string]> = {
  aman: ["Aman", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"],
  tipis: ["Tipis", "bg-amber-500/10 text-amber-700 dark:text-amber-400"],
  bawah: ["Di bawah lantai", "bg-red-500/10 text-red-700 dark:text-red-400"],
  na: ["Belum ada data", "bg-slate-500/10 text-slate-700 dark:text-slate-300"],
};
const SELECT_CLS = "rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-50";

const angka = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("id-ID"));
const bulanId = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { month: "short", year: "numeric" });

function lantai(a: number | null, bt: number, v: number | null, hpp: number | null, k: number, bulan: number): number | null {
  if (a == null || !v || v <= 0) return null;
  const c = a + bt / v;
  return !hpp || hpp <= 0 ? c : c + (k * hpp) / bulan / v;
}

function Pill({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>{children}</span>;
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
    if (status === "bawah" && b.posisi !== "bawah") return false;
    if (status === "idle" && b.idle === 0) return false;
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
    ["Realisasi di bawah lantai", d.baris.filter((b) => b.posisi === "bawah").length],
    ["Sudah diputus", `${d.baris.filter((b) => b.keputusan?.keputusan).length} / ${d.baris.length}`],
  ];

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Batas harga minimum per tes untuk tiap model alat. Direktur menetapkan, Komite memakainya sebagai pegangan saat bilang ya atau tidak.
        {d.periode && <> Omzet {bulanId(d.periode.dari)}–{bulanId(d.periode.sampai)}; angka belum diaudit.</>}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stat.map(([l, v]) => (
          <div key={l} className="bg-card rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{l}</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{typeof v === "number" ? angka(v) : v}</div>
          </div>
        ))}
      </div>
      <Parameter p={p} bolehUbah={d.bolehUbah} onBerubah={muat} />

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
            <option value="bawah">Realisasi di bawah lantai</option>
            <option value="idle">Ada unit idle</option>
          </select>
        </label>
        <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs sm:max-w-xs">Cari model / faskes
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="mis. Z52, Muslimat" />
        </label>
      </div>

      {tampil.length === 0 ? <EmptyState title="Tidak ada model yang cocok" description="Ubah filter atau kata cari." /> : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead><tr className="border-b text-left text-xs">
              <th className="p-2">Model</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">HPP</th>
              <th className="p-2 text-right">Omzet/unit/bln</th><th className="p-2 text-right">Volume historis</th>
              <th className="p-2 text-right">Biaya reagen/tes</th><th className="p-2 text-right">Lantai usulan</th>
              <th className="p-2 text-right">Realisasi Rp/tes</th><th className="p-2">Posisi</th>
              <th className="p-2 text-right">Bottom line</th><th className="p-2">Keputusan</th>
            </tr></thead>
            <tbody>
              {tampil.map((b, i) => (
                <FragmentBaris key={b.model_key} b={b} judul={i === 0 || tampil[i - 1].kelompok !== b.kelompok} onBuka={setBuka} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Volume historis = median omzet per unit per bulan (unit yang jalan) ÷ Rp/tes jenis; omzet faskes per jenis dibagi rata ke unit sejenis di faskes itu.
        HPP = aset tetap ALAT KSO yang nomor serinya cocok, perolehan terbaru (median bila terbaru menyimpang &gt;40%).
        Lantai usulan dihitung di volume historis, HPP, K dan bulan di atas. Klik baris untuk keputusan, sensitivitas volume, dan daftar unit.
      </p>
      {d.bolehUbah && <AcuanJenis jenis={d.jenis} onBerubah={muat} />}
      {aktif && <DetailModel key={aktif.model_key} b={aktif} p={p} bolehUbah={d.bolehUbah} onClose={() => setBuka(null)} onBerubah={muat} />}
    </div>
  );
}

function FragmentBaris({ b, judul, onBuka }: { b: Baris; judul: boolean; onBuka: (k: string) => void }) {
  const satuan = b.satuan === "tindakan" ? "tindakan" : "tes";
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
        <td className="p-2 text-right tabular-nums">{rpJt(b.hpp)}{b.hpp == null ? <div className="text-muted-foreground text-xs">belum ada</div> : b.hpp_tgl && <div className="text-muted-foreground text-xs">{b.hpp_tgl.slice(0, 7)}</div>}</td>
        <td className="p-2 text-right tabular-nums">{rpJt(b.omzet_unit_bln)}</td>
        <td className="p-2 text-right tabular-nums">{b.volume ? `${angka(b.volume)} ${satuan}` : "—"}</td>
        <td className="p-2 text-right tabular-nums">{angka(b.biaya_di_volume ?? b.biaya_per_tes)}</td>
        <td className="p-2 text-right tabular-nums">{angka(b.lantai_usulan)}</td>
        <td className="p-2 text-right tabular-nums">{angka(b.rupiah_per_tes)}</td>
        <td className="p-2"><Pill cls={POSISI[b.posisi][1]}>{POSISI[b.posisi][0]}</Pill></td>
        <td className="text-primary p-2 text-right font-bold tabular-nums">{b.lantai_final ? angka(b.lantai_final) : "—"}</td>
        <td className="p-2">{b.keputusan?.keputusan
          ? <Pill cls="bg-sky-500/10 text-sky-700 dark:text-sky-400">{b.keputusan.keputusan}</Pill>
          : <Pill cls={POSISI.na[1]}>Belum diputus</Pill>}</td>
      </tr>
    </>
  );
}

function Parameter({ p, bolehUbah, onBerubah }: { p: Data["parameter"]; bolehUbah: boolean; onBerubah: () => void }) {
  const [k, setK] = useState(String(p.k)), [bln, setBln] = useState(String(p.bulan)), [buf, setBuf] = useState(String(p.penyangga_pct));
  const [pesan, setPesan] = useState<string | null>(null);
  const simpan = async () => {
    setPesan(null);
    try {
      await kirim("/api/kso-komite/bottom-line/parameter", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ k: Number(k), bulan: Number(bln), penyangga_pct: Number(buf) }) });
      setPesan("Parameter tersimpan."); onBerubah();
    } catch (e) { setPesan((e as Error).message); }
  };
  return (
    <div className="bg-card flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border p-3">
      <code className="text-xs">Lantai/tes = biaya reagen+QC per tes + (K × HPP) ÷ bulan ÷ volume per bulan</code>
      {([["K (× HPP)", k, setK, "0.5"], ["Bulan", bln, setBln, "1"], ["Penyangga AM %", buf, setBuf, "1"]] as const).map(([l, v, set, step]) => (
        <label key={l} className="text-muted-foreground flex items-center gap-1.5 text-xs">{l}
          <Input type="number" step={step} className="h-8 w-20 tabular-nums" value={v} disabled={!bolehUbah} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      {bolehUbah && <Button size="sm" onClick={simpan}>Simpan parameter</Button>}
      {pesan && <span className="text-xs">{pesan}</span>}
      {!bolehUbah && <span className="text-xs text-amber-700 dark:text-amber-400">Mode baca — hanya Direktur yang mengubah.</span>}
    </div>
  );
}

function DetailModel({ b, p, bolehUbah, onClose, onBerubah }: { b: Baris; p: Data["parameter"]; bolehUbah: boolean; onClose: () => void; onBerubah: () => void }) {
  const d = b.keputusan;
  const [hpp, setHpp] = useState(String(d?.hpp ?? b.hpp ?? ""));
  const [vol, setVol] = useState(String(d?.volume ?? b.volume ?? ""));
  const [k, setK] = useState(String(d?.k ?? p.k));
  const [final, setFinal] = useState(d?.lantai_final ? String(d.lantai_final) : "");
  const [kep, setKep] = useState(d?.keputusan ?? "");
  const [cat, setCat] = useState(d?.catatan ?? "");
  const [biaya, setBiaya] = useState(b.biaya_per_tes == null ? "" : String(b.biaya_per_tes));
  const [tetap, setTetap] = useState(String(b.biaya_tetap_bulan ?? 0));
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const satuan = b.satuan === "tindakan" ? "tindakan" : "tes";

  const a = biaya === "" ? null : Number(biaya), bt = Number(tetap) || 0;
  const hppU = Number(hpp) || b.hpp, volU = Number(vol) || b.volume, kU = Number(k) || p.k;
  const hitung = lantai(a, bt, volU, hppU, kU, p.bulan);
  // isian HPP/volume/K sama dengan nilai bawaan → simpan kosong supaya tetap ikut data terbaru
  const beda = (x: string, asal: number | null) => (x === "" || Number(x) === asal ? null : Number(x));

  const kirimPost = async (jenis: string, body: Record<string, unknown>, ok: string) => {
    setSibuk(true); setPesan(null);
    try {
      await kirim(`/api/kso-komite/bottom-line/${jenis}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setPesan(ok); onBerubah();
    } catch (e) { setPesan((e as Error).message); } finally { setSibuk(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{b.model} <span className="text-muted-foreground font-normal">· {b.jenis}</span></DialogTitle>
          <DialogDescription>
            {b.unit} unit{b.idle ? ` · ${b.idle} idle` : ""}{b.tanpa_faskes ? ` · ${b.tanpa_faskes} tanpa faskes` : ""} · realisasi {rp(b.rupiah_per_tes)}/{satuan}
            {b.rupiah_per_tes_sumber === "manual" ? " (acuan manual)" : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">Keputusan Direktur</h3>
            <div className="grid grid-cols-2 gap-3">
              <Isian label="HPP dipakai (Rp)" v={hpp} set={setHpp} step="100000" off={!bolehUbah} />
              <Isian label={`Volume acuan (${satuan}/unit/bln)`} v={vol} set={setVol} step="10" off={!bolehUbah} />
              <Isian label="Kelipatan K (× HPP)" v={k} set={setK} step="0.5" off={!bolehUbah} />
              <Isian label={`Bottom line final per ${satuan} (kosong = hitungan)`} v={final} set={setFinal} step="100" off={!bolehUbah} />
              <div className="grid gap-1">
                <Label className="text-xs">Keputusan</Label>
                <select className={SELECT_CLS} value={kep} disabled={!bolehUbah} onChange={(e) => setKep(e.target.value)}>
                  <option value="">— pilih —</option>
                  {KEPUTUSAN.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="col-span-2 grid gap-1">
                <Label className="text-xs">Catatan untuk Komite</Label>
                <Input value={cat} disabled={!bolehUbah} onChange={(e) => setCat(e.target.value)} placeholder="mis. hanya untuk RS ≥ 750 sampel; tawarkan Z3 di bawah itu" />
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-5 border-t border-dashed pt-3">
              <div><div className="text-muted-foreground text-xs">Lantai hasil hitung</div><div className="text-primary text-2xl font-extrabold tabular-nums">{angka(hitung)}</div></div>
              <div><div className="text-muted-foreground text-xs">Zona AM (≥ lantai + {p.penyangga_pct}%)</div><div className="font-bold tabular-nums">{hitung ? angka(hitung * (1 + p.penyangga_pct / 100)) : "—"}</div></div>
              {bolehUbah && (
                <Button size="sm" disabled={sibuk} onClick={() => kirimPost("keputusan", {
                  model_key: b.model_key, hpp: beda(hpp, b.hpp), volume: beda(vol, b.volume), k: beda(k, p.k),
                  lantai_final: final === "" ? null : Number(final), keputusan: kep || null, catatan: cat,
                }, "Keputusan tersimpan.")}>Simpan keputusan</Button>
              )}
            </div>
            {d && <p className="text-muted-foreground text-xs">Terakhir diputus {waktu(d.diputus_at)}{d.diputus_nama ? ` oleh ${d.diputus_nama}` : ""}.</p>}
            {pesan && <p className="text-sm">{pesan}</p>}
            <p className="text-muted-foreground text-xs">
              HPP: {b.hpp_sumber} ({b.unit_ber_hpp}/{b.unit} unit cocok SN){b.hpp_median && b.hpp_median !== b.hpp ? ` · median ${rpJt(b.hpp_median)}` : ""}.
              {" "}Biaya reagen: {b.biaya_sumber ?? "belum diisi"}{b.biaya_keyakinan ? ` · keyakinan ${b.biaya_keyakinan}` : ""}.
              {b.satuan === "tindakan" && " HD dengan aturan 3× HPP / 36 bln bisa menghasilkan lantai di atas tarif yang biasa diterima; pertimbangkan aturan Kalkulator HD (margin ≥ 15% sepanjang tenor)."}
            </p>
            {bolehUbah && (
              <div className="space-y-2 rounded-md border p-3">
                <h3 className="text-muted-foreground text-xs font-semibold uppercase">Biaya reagen model ini</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Isian label={`Reagen per ${satuan} (Rp)`} v={biaya} set={setBiaya} step="100" />
                  <Isian label="Biaya tetap per bulan — kalibrasi + QC (Rp)" v={tetap} set={setTetap} step="10000" />
                </div>
                <Button size="sm" variant="outline" disabled={sibuk || biaya === ""} onClick={() => kirimPost("biaya", {
                  model_key: b.model_key, biaya_per_tes: Number(biaya), biaya_tetap_bulan: Number(tetap) || 0, sumber: "isian Direktur", keyakinan: "High",
                }, "Biaya reagen tersimpan.")}>Simpan biaya</Button>
              </div>
            )}
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">Sensitivitas volume</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b"><th className="p-1 text-left">{satuan === "tes" ? "Tes/bln" : "Tindakan/bln"}</th>{b.grid.map((v) => <th key={v} className="p-1 text-right tabular-nums">{angka(v)}</th>)}</tr>
                  <tr className="border-b"><td className="p-1">Biaya reagen</td>{b.grid.map((v) => <td key={v} className="p-1 text-right tabular-nums">{angka(a == null ? null : a + bt / v)}</td>)}</tr>
                  <tr><td className="p-1 font-bold">Lantai</td>{b.grid.map((v) => <td key={v} className="p-1 text-right font-bold tabular-nums">{angka(lantai(a, bt, v, hppU, kU, p.bulan))}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">Unit ({b.unit})</h3>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left"><th className="p-1.5">Faskes</th><th className="p-1.5">Skema</th><th className="p-1.5">Status</th><th className="p-1.5 text-right">HPP SN</th><th className="p-1.5 text-right">Omzet/bln</th></tr></thead>
                <tbody>
                  {b.units.map((u, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-1.5">{u.faskes ?? "—"}</td>
                      <td className="p-1.5">{u.skema.replace("_", " ")}</td>
                      <td className="p-1.5">{u.status === "Jalan" ? "Jalan" : <Pill cls={u.status === "Idle" ? POSISI.bawah[1] : POSISI.na[1]}>{u.status}</Pill>}</td>
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

function Isian({ label, v, set, step, off }: { label: string; v: string; set: (s: string) => void; step: string; off?: boolean }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} className="tabular-nums" value={v} disabled={off} onChange={(e) => set(e.target.value)} />
    </div>
  );
}

/** Acuan per jenis — Rp/tes pengganti (HD: tarif per tindakan) & margin kotor untuk taksiran biaya. Hanya Direktur. */
function AcuanJenis({ jenis, onBerubah }: { jenis: Jenis[]; onBerubah: () => void }) {
  const [buka, setBuka] = useState(false);
  const [isi, setIsi] = useState<Record<string, { rpt: string; gm: string }>>(
    () => Object.fromEntries(jenis.map((j) => [j.jenis, { rpt: j.rupiah_per_tes_manual ?? "", gm: j.margin_kotor ?? "" }])));
  const [pesan, setPesan] = useState<string | null>(null);
  const simpan = async (j: string) => {
    setPesan(null);
    try {
      await kirim("/api/kso-komite/bottom-line/jenis", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jenis: j, rupiah_per_tes_manual: isi[j].rpt || null, margin_kotor: isi[j].gm === "" ? null : Number(isi[j].gm) }) });
      setPesan(`${j} tersimpan.`); onBerubah();
    } catch (e) { setPesan((e as Error).message); }
  };
  return (
    <section className="bg-card rounded-lg border p-3">
      <button type="button" className="text-sm font-semibold" onClick={() => setBuka(!buka)}>{buka ? "▾" : "▸"} Acuan per jenis alat (Rp/tes pengganti &amp; margin kotor)</button>
      {buka && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">Rp/tes kosong = pakai realisasi OS. Isi untuk jenis yang realisasinya tidak bermakna (mis. Hemodialisa: tarif per tindakan).
            Margin kotor dipakai menaksir biaya reagen model yang belum punya isian biaya: Rp/tes × (1 − margin).</p>
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
