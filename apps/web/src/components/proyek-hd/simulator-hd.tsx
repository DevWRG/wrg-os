"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  BATAS_TINDAKAN_SEHAT, CONSUMABLE, hitungMargin, hitungProyeksi, marginAwal, proyeksiAwal,
  type MarginInput, type ParamMap, type ProyeksiInput,
} from "@/lib/proyek-hd/simulator";

import { kirim, rp, rpRingkas, tgl, type Detail, type Param, type Proyek } from "./types";

type Jenis = "proyeksi_rs" | "margin_wrg";
interface Tersimpan { id: number; jenis: Jenis; label: string | null; input: Record<string, unknown>; ringkasan: string; oleh: string | null; dibuat_at: string }

const persen = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

// Simulator HD. Tab Margin WRG hanya dirender bila `bolehMargin` — dan BFF juga tidak
// mengirim parameter margin_* / simulasi margin ke selain pemegang 'proyek-hd-margin'.
export function SimulatorHd({ proyekId, bolehMargin, bolehSimpan, tabAwal }: {
  proyekId: string | null; bolehMargin: boolean; bolehSimpan: boolean; tabAwal: Jenis;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Jenis>(bolehMargin ? tabAwal : "proyeksi_rs");
  const [daftar, setDaftar] = useState<Proyek[]>([]);
  const [proyek, setProyek] = useState<Proyek | null>(null);
  const [px, setPx] = useState<ProyeksiInput | null>(null);
  const [mg, setMg] = useState<MarginInput | null>(null);
  const [kosong, setKosong] = useState<{ rs: string[]; margin: string[] }>({ rs: [], margin: [] });
  const [saved, setSaved] = useState<Tersimpan[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const muatTersimpan = useCallback(() => {
    if (!proyekId) return;
    kirim<{ items: Tersimpan[] }>(`/api/proyek-hd/${encodeURIComponent(proyekId)}/simulasi`).then((d) => setSaved(d.items)).catch(() => undefined);
  }, [proyekId]);

  useEffect(() => {
    let batal = false;
    Promise.all([
      kirim<{ items: Param[] }>("/api/proyek-hd/param"),
      kirim<{ items: Proyek[] }>("/api/proyek-hd"),
      proyekId ? kirim<Detail>(`/api/proyek-hd/${encodeURIComponent(proyekId)}`) : Promise.resolve(null),
    ]).then(([pr, l, det]) => {
      if (batal) return;
      const pm: ParamMap = Object.fromEntries(pr.items.map((x) => [x.kunci, x.nilai]));
      const a = proyeksiAwal(pm);
      const b = marginAwal(pm);
      const p = det?.proyek ?? null;
      setProyek(p);
      setDaftar(l.items);
      // Isi awal dari proyek: jumlah mesin = unit KSO, harga mesin = harga unit proyek.
      setPx(p && p.unit_kso > 0 ? { ...a.input, mesin: p.unit_kso } : a.input);
      if (bolehMargin) {
        setMg({ ...b.input, ...(p && p.unit_kso > 0 ? { mesin: p.unit_kso } : {}), ...(p?.harga_unit ? { harga_mesin: p.harga_unit } : {}) });
      }
      setKosong({ rs: a.kosong, margin: bolehMargin ? b.kosong : [] });
    }).catch((e) => { if (!batal) setErr((e as Error).message); });
    muatTersimpan();
    return () => { batal = true; };
  }, [proyekId, bolehMargin, muatTersimpan]);

  const pindahProyek = (v: string) => router.push(`/proyek-hd/simulator${v ? `?proyek=${encodeURIComponent(v)}` : ""}${tab === "margin_wrg" ? `${v ? "&" : "?"}tab=margin` : ""}`);

  function buka(s: Tersimpan) {
    if (s.jenis === "proyeksi_rs" && px) { setPx({ ...px, ...(s.input as Partial<ProyeksiInput>) }); setTab("proyeksi_rs"); }
    if (s.jenis === "margin_wrg" && mg) { setMg({ ...mg, ...(s.input as Partial<MarginInput>) }); setTab("margin_wrg"); }
  }

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!px) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const kosongTab = tab === "proyeksi_rs" ? kosong.rs : kosong.margin;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="min-w-64 flex-1 space-y-1">
            <Label>Proyek</Label>
            <Combobox value={proyekId ?? ""} onChange={pindahProyek} emptyOption="— tanpa proyek (simulasi bebas) —"
              options={daftar.map((p) => ({ value: String(p.id), label: `${p.nama_rs} · ${p.kode}` }))} searchPlaceholder="Cari RS…" />
          </div>
          <p className="text-muted-foreground max-w-xl text-xs">
            {tab === "proyeksi_rs"
              ? "Untuk dibawa ke direktur RS + nefrolog: berapa tindakan, klaim RS, dan omset Wahana."
              : "Internal: biaya per tindakan vs pendapatan WRG. Jangan ditampilkan ke RS, vendor, atau tim sales."}
          </p>
        </CardContent>
      </Card>

      {kosongTab.length > 0 && (
        <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Parameter belum diisi admin ({kosongTab.join(", ")}) — dihitung sebagai 0. Isi lewat tombol Parameter di halaman Proyek HD, atau ketik langsung di bawah.
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Jenis)}>
        <TabsList>
          <TabsTrigger value="proyeksi_rs">Proyeksi RS</TabsTrigger>
          {bolehMargin && <TabsTrigger value="margin_wrg">Margin WRG</TabsTrigger>}
        </TabsList>
        <TabsContent value="proyeksi_rs" className="pt-4"><TabProyeksi v={px} set={setPx} /></TabsContent>
        {bolehMargin && mg && <TabsContent value="margin_wrg" className="pt-4"><TabMargin v={mg} set={setMg} /></TabsContent>}
      </Tabs>

      {proyek ? (
        <KartuSimpan key={tab} proyekId={proyek.id} jenis={tab} input={tab === "proyeksi_rs" ? px : mg} saved={saved.filter((s) => s.jenis === tab)}
          bolehSimpan={bolehSimpan} onSaved={muatTersimpan} onBuka={buka} />
      ) : (
        <p className="text-muted-foreground text-sm">Pilih proyek di atas untuk menyimpan hasil simulasi.</p>
      )}
    </div>
  );
}

/** Slider + angka. Angka boleh diketik di luar rentang slider. */
function Isian({ label, value, onChange, min, max, step, fmt }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; fmt?: (v: number) => string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="flex items-baseline justify-between gap-2"><span className="font-medium">{label}</span><span className="text-muted-foreground text-xs">{fmt ? fmt(value) : value}</span></span>
      <span className="flex items-center gap-2">
        <input type="range" aria-label={label} min={min} max={Math.max(max, value)} step={step} value={value}
          onChange={(e) => onChange(+e.target.value)} className="accent-primary min-w-0 flex-1" />
        <Input type="number" aria-label={`${label} (angka)`} min={0} step={step} value={value} className="bg-card h-8 w-32 text-right"
          onChange={(e) => onChange(Math.max(0, +e.target.value || 0))} />
      </span>
    </label>
  );
}

function Angka({ label, nilai, sub, tint }: { label: string; nilai: string; sub?: string; tint?: boolean }) {
  return (
    <div className={cn("space-y-1 rounded-lg border p-3", tint ? "border-primary/40 bg-primary/10" : "bg-card")}>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="text-xl font-semibold tracking-tight">{nilai}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

function TabProyeksi({ v, set }: { v: ProyeksiInput; set: (v: ProyeksiInput) => void }) {
  const r = useMemo(() => hitungProyeksi(v), [v]);
  const u = <K extends keyof ProyeksiInput>(k: K) => (x: ProyeksiInput[K]) => set({ ...v, [k]: x });
  const baca = {
    kurang_tindakan: { cls: "border-l-destructive", teks: `Di bawah ±${BATAS_TINDAKAN_SEHAT} tindakan/bulan. Biaya tetap terlalu berat per tindakan. Tanya rencana tambah pasien atau shift.` },
    kurang_shift: { cls: "border-l-amber-400", teks: `Mesin kurang penuh (${String(v.shift).replace(".", ",")} shift). Dorong RS ke 2 shift sebelum tambah mesin.` },
    sehat: { cls: "border-l-emerald-600", teks: `Unit sehat: ${r.tindakan_bln.toLocaleString("id-ID")} tindakan, ±${r.pasien_tetap} pasien. Wahana ${rpRingkas(r.omset_wahana_thn)}/tahun dari satu RS. Lanjut survei.` },
  }[r.kesehatan];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[5fr_6fr]">
      <Card>
        <CardHeader><CardTitle>Parameter</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Isian label="Mesin aktif" value={v.mesin} onChange={u("mesin")} min={1} max={40} step={1} fmt={(x) => `${x} unit`} />
          <Isian label="Shift / mesin / hari" value={v.shift} onChange={u("shift")} min={1} max={3} step={0.5} />
          <Isian label="Hari operasi / bulan" value={v.hari} onChange={u("hari")} min={20} max={26} step={1} />
          <Isian label="Tarif klaim / tindakan" value={v.tarif_klaim} onChange={u("tarif_klaim")} min={0} max={2_000_000} step={100} fmt={rp} />
          <div className="space-y-1">
            <span className="text-sm font-medium">RS bayar Wahana</span>
            <div className="flex gap-2">
              <Button size="sm" variant={v.mode === "bagi_hasil" ? "default" : "outline"} onClick={() => u("mode")("bagi_hasil")}>Bagi hasil</Button>
              <Button size="sm" variant={v.mode === "harga_tetap" ? "default" : "outline"} onClick={() => u("mode")("harga_tetap")}>Harga tetap</Button>
            </div>
          </div>
          {v.mode === "bagi_hasil"
            ? <Isian label="Porsi Wahana" value={v.porsi_pct} onChange={u("porsi_pct")} min={0} max={100} step={1} fmt={(x) => `${x}%`} />
            : <Isian label="Harga tetap / tindakan" value={v.harga_tetap} onChange={u("harga_tetap")} min={0} max={1_000_000} step={5000} fmt={rp} />}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Angka label="Tindakan / bulan" nilai={r.tindakan_bln.toLocaleString("id-ID")} sub="mesin × shift × hari" />
          <Angka label="Pasien tetap" nilai={`±${r.pasien_tetap}`} sub="tindakan ÷ 11" />
          <Angka label="Klaim RS / bulan" nilai={rpRingkas(r.klaim_rs_bln)} sub={`Set consumable ${r.tindakan_bln.toLocaleString("id-ID")}/bln`} />
          <Angka label="Wahana / tindakan" nilai={rpRingkas(r.wahana_per_tindakan)} sub={v.mode === "bagi_hasil" ? `${v.porsi_pct}% dari tarif klaim` : "harga tetap"} />
          <Angka tint label="Omset Wahana / bulan" nilai={rpRingkas(r.omset_wahana_bln)} />
          <Angka tint label="Omset Wahana / tahun" nilai={rpRingkas(r.omset_wahana_thn)} />
        </div>
        <div role="status" className={cn("bg-card rounded-lg border border-l-8 p-4 text-sm", baca.cls)}>
          <strong className="mb-1 block">Pembacaan</strong>{baca.teks}
        </div>
      </div>
    </div>
  );
}

function Baris({ l, n, tebal }: { l: string; n: string; tebal?: boolean }) {
  return <div className={cn("flex justify-between gap-4 py-1", tebal && "border-t pt-2 font-semibold")}><span>{l}</span><span className="text-right">{n}</span></div>;
}

function TabMargin({ v, set }: { v: MarginInput; set: (v: MarginInput) => void }) {
  const r = useMemo(() => hitungMargin(v), [v]);
  const u = (k: keyof MarginInput) => (x: number) => set({ ...v, [k]: x });
  const jt = (x: number) => rpRingkas(x);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[5fr_6fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Consumable / tindakan (ex PPN)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {CONSUMABLE.map((it) => (
              <Isian key={it.key} label={`${it.label}${it.qty > 1 ? ` (×${it.qty}, harga satuan)` : ""}`} value={v[it.key]} onChange={u(it.key)}
                min={0} max={Math.max(150_000, v[it.key])} step={100} fmt={rp} />
            ))}
            <p className="text-muted-foreground text-xs">Set ex PPN {rp(r.set_ex_ppn)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Alat & kontrak KSO</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Isian label="Mesin HD / unit (ex PPN)" value={v.harga_mesin} onChange={u("harga_mesin")} min={0} max={400_000_000} step={1_000_000} fmt={jt} />
            <Isian label="RO + pipanisasi + instalasi" value={v.ro} onChange={u("ro")} min={0} max={500_000_000} step={5_000_000} fmt={jt} />
            <Isian label="Mesin aktif" value={v.mesin} onChange={u("mesin")} min={1} max={100} step={1} fmt={(x) => `${x} unit`} />
            <Isian label="Mesin backup" value={v.backup} onChange={u("backup")} min={0} max={10} step={1} fmt={(x) => `${x} unit`} />
            <Isian label="Tindakan / mesin / hari" value={v.tindakan_per_hari} onChange={u("tindakan_per_hari")} min={1} max={4} step={0.5} />
            <Isian label="Hari operasional / bulan" value={v.hari} onChange={u("hari")} min={20} max={30} step={1} />
            <Isian label="Tenor KSO" value={v.tenor} onChange={u("tenor")} min={1} max={10} step={1} fmt={(x) => `${x} tahun`} />
            <Isian label="Pendapatan WRG / tindakan" value={v.pendapatan} onChange={u("pendapatan")} min={0} max={1_000_000} step={1000} fmt={rp} />
            <Isian label="Revenue sharing WRG" value={v.share_pct} onChange={u("share_pct")} min={0} max={100} step={5} fmt={(x) => `${x}%`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Operasional</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Isian label="Gaji teknisi / bulan (×13/tahun)" value={v.gaji_teknisi} onChange={u("gaji_teknisi")} min={0} max={20_000_000} step={500_000} fmt={jt} />
            <Isian label="Fee DPJP / tindakan" value={v.fee_dpjp} onChange={u("fee_dpjp")} min={0} max={50_000} step={1000} fmt={rp} />
            <Isian label="Kirim consumable / tindakan" value={v.kirim} onChange={u("kirim")} min={0} max={50_000} step={1000} fmt={rp} />
            <Isian label="Lab air / tahun" value={v.lab_air} onChange={u("lab_air")} min={0} max={50_000_000} step={1_000_000} fmt={jt} />
            <Isian label="Diklat perawat / tahun" value={v.diklat} onChange={u("diklat")} min={0} max={50_000_000} step={500_000} fmt={jt} />
            <Isian label="Kalibrasi / mesin / tahun (mulai th. 2)" value={v.kalibrasi} onChange={u("kalibrasi")} min={0} max={3_000_000} step={50_000} fmt={rp} />
            <Isian label="Pitnas-Pitwil / tahun" value={v.pitnas} onChange={u("pitnas")} min={0} max={30_000_000} step={500_000} fmt={jt} />
            <Isian label="Renovasi + inventaris, sekali" value={v.renovasi} onChange={u("renovasi")} min={0} max={1_500_000_000} step={10_000_000} fmt={jt} />
            <Isian label="Biaya lain / tindakan" value={v.lain_per_tindakan} onChange={u("lain_per_tindakan")} min={0} max={20_000} step={100} fmt={rp} />
            <Isian label="Biaya lain / hari operasi" value={v.lain_harian} onChange={u("lain_harian")} min={0} max={200_000} step={1000} fmt={rp} />
            <Isian label="Biaya lain / bulan" value={v.lain_bln} onChange={u("lain_bln")} min={0} max={5_000_000} step={50_000} fmt={rp} />
            <Isian label="Ambang margin minimum" value={v.min_pct} onChange={u("min_pct")} min={0} max={40} step={1} fmt={(x) => `${x}%`} />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
        <Card>
          <CardHeader><CardTitle>Biaya per tindakan</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <Baris l="HD set (incl PPN)" n={rp(r.biaya_set)} />
            <Baris l="Mesin HD + RO" n={rp(r.biaya_alat)} />
            <Baris l="SDM, lab air, diklat, kalibrasi, kirim, lain-lain" n={rp(r.biaya_ops)} />
            <Baris l="Total biaya" n={rp(r.biaya_total)} tebal />
            <Baris l="Pendapatan WRG" n={rp(r.pendapatan_per_tindakan)} />
          </CardContent>
        </Card>
        <div role="status" className={cn("bg-card space-y-1 rounded-lg border border-l-8 p-4", r.layak ? "border-l-emerald-600" : "border-l-destructive")}>
          <div className="text-muted-foreground text-xs font-medium">Margin WRG per tindakan</div>
          <div className={cn("text-3xl font-bold", r.layak ? "text-emerald-600" : "text-destructive")}>{persen(r.margin_pct)} · {rp(r.margin_per_tindakan)}</div>
          <div className="text-sm">{r.layak ? `Di atas ${v.min_pct}%: bisa ditandatangani.` : `Di bawah ${v.min_pct}%: belum bisa ditandatangani.`}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Angka label="Tindakan / bulan" nilai={r.tindakan_bln.toLocaleString("id-ID")} sub={`${r.tindakan_tenor.toLocaleString("id-ID")} selama tenor`} />
          <Angka label="Margin / bulan" nilai={rpRingkas(r.margin_bln)} />
          <Angka label="Margin / tahun" nilai={rpRingkas(r.margin_thn)} />
          <Angka tint label="Profit selama tenor" nilai={rpRingkas(r.margin_tenor)} />
        </div>
        <Card>
          <CardHeader><CardTitle>Belanja ke vendor</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <Baris l={`Mesin, sekali (${v.mesin + v.backup} unit)`} n={rpRingkas(r.beli_mesin)} />
            <Baris l="Consumable / bulan" n={rpRingkas(r.beli_consumable_bln)} />
            <Baris l="Consumable selama tenor" n={rpRingkas(r.beli_consumable_tenor)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KartuSimpan({ proyekId, jenis, input, saved, bolehSimpan, onSaved, onBuka }: {
  proyekId: number; jenis: Jenis; input: unknown; saved: Tersimpan[]; bolehSimpan: boolean; onSaved: () => void; onBuka: (s: Tersimpan) => void;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; teks: string } | null>(null);

  async function simpan() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await kirim<{ id: number }>(`/api/proyek-hd/${proyekId}/simulasi`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jenis, label, input }),
      });
      setMsg({ ok: true, teks: `Tersimpan (#${r.id}).` });
      setLabel("");
      onSaved();
    } catch (e) {
      setMsg({ ok: false, teks: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Simulasi tersimpan · {jenis === "proyeksi_rs" ? "Proyeksi RS" : "Margin WRG"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {bolehSimpan && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1"><Label htmlFor="sim-label">Label (opsional)</Label>
              <Input id="sim-label" className="bg-card" maxLength={120} value={label} placeholder="mis. usulan ke direktur RS" onChange={(e) => setLabel(e.target.value)} /></div>
            <Button disabled={busy} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan simulasi"}</Button>
          </div>
        )}
        {msg && <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-destructive")}>{msg.teks}</p>}
        {saved.length === 0 ? <p className="text-muted-foreground text-sm">Belum ada simulasi tersimpan untuk proyek ini.</p> : (
          <div className="space-y-2 text-sm">
            {saved.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2 last:border-b-0">
                <span className="text-muted-foreground w-24">{tgl(s.dibuat_at)}</span>
                <div className="min-w-0 flex-1"><strong>{s.label || `Simulasi #${s.id}`}</strong>
                  <div className="text-muted-foreground text-xs">{s.ringkasan} · {s.oleh ?? "—"}</div></div>
                <Button size="sm" variant="soft" onClick={() => onBuka(s)}>Buka</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
