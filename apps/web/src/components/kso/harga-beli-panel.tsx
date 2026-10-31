"use client";

// F145 Fase B (migrasi 264, Pedoman Komite KSO Forum v01) — Finance mengisi harga beli WRG per kemasan
// reagen / kit parameter, kode barang Accurate (saran harga dari PO terakhir), dan pemetaan analyzer →
// model F172 (sumber HPP alat). Data & izin dari apps/api/src/repo/kso-harga-beli.ts.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Baris {
  id: number; nama: string; pack: string | null; harga_dp: number | null; harga_pl: number | null; harga_beli: number | null;
  accurate_item_no: string | null; harga_beli_sumber: string | null; harga_beli_at: string | null;
  po_item: string | null; po_unit: string | null; po_harga: number | null; po_number: string | null; po_tanggal: string | null; po_vendor: string | null;
}
interface Reagen extends Baris { kategori: string; analyzer: string; analyzer_label: string; kode: string; jenis: string }
interface Parameter extends Baris { grup: string; no: number; panel: string | null; tests_per_kit: number | null }
interface Analyzer { id: number; kategori: string; kode: string; label: string; default_capex: number | null; default_capex_pl: number | null; model_key: string | null; hpp: number | null; hpp_sumber: string | null }
interface Data { bolehUbah: boolean; reagen: Reagen[]; parameter: Parameter[]; analyzer: Analyzer[]; model: { model_key: string; model: string; jenis: string; hpp: number | null }[] }

const rp = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("id-ID"));
const SELECT_CLS = "rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50";

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
const simpan = (body: Record<string, unknown>) =>
  kirim("/api/kso/harga-beli", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function HargaBeliPanel({ onTutup }: { onTutup: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [tab, setTab] = useState<"reagen" | "parameter" | "alat">("reagen");
  const [cari, setCari] = useState("");
  const [kosong, setKosong] = useState(false);
  const muat = useCallback(() => {
    kirim<Data>("/api/kso/harga-beli").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const q = cari.trim().toLowerCase();
  const reagen = useMemo(() => (d?.reagen ?? []).filter((r) =>
    (!q || `${r.analyzer} ${r.nama} ${r.accurate_item_no ?? ""}`.toLowerCase().includes(q)) && (!kosong || r.harga_beli == null)), [d, q, kosong]);
  const parameter = useMemo(() => (d?.parameter ?? []).filter((p) =>
    (!q || `${p.grup} ${p.nama} ${p.panel ?? ""} ${p.accurate_item_no ?? ""}`.toLowerCase().includes(q)) && (!kosong || p.harga_beli == null)), [d, q, kosong]);

  const jalankan = async (body: Record<string, unknown>, ok: string) => {
    setPesan(null);
    try { await simpan(body); setPesan(ok); muat(); } catch (e) { setPesan((e as Error).message); }
  };

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const terisi = (xs: Baris[]) => xs.filter((x) => x.harga_beli != null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Kelola harga beli</h2>
          <p className="text-muted-foreground text-sm">
            Harga beli WRG per <b>kemasan</b> (satuan sama dengan kolom harga distributor). Kosong = simulator memakai harga lama.
            Saran PO = harga satuan PO Accurate terakhir untuk kode barang itu — cek satuannya sebelum dipakai.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onTutup}>Kembali ke simulator</Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([["Reagen & consumable", terisi(d.reagen), d.reagen.length], ["Parameter (KK/CLIA)", terisi(d.parameter), d.parameter.length],
          ["Alat dengan HPP", d.analyzer.filter((a) => a.hpp != null).length, d.analyzer.length]] as const).map(([l, a, b]) => (
          <div key={l} className="bg-card rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{l}</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{a} / {b}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {(["reagen", "parameter", "alat"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
            {t === "reagen" ? "Reagen" : t === "parameter" ? "Parameter" : "Alat (HPP)"}
          </Button>
        ))}
        {tab !== "alat" && (
          <>
            <Input className="h-8 max-w-xs" placeholder="Cari nama / analyzer / kode barang" value={cari} onChange={(e) => setCari(e.target.value)} />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={kosong} onChange={(e) => setKosong(e.target.checked)} /> hanya yang belum diisi</label>
          </>
        )}
      </div>
      {pesan && <p className="text-sm">{pesan}</p>}
      {!d.bolehUbah && <p className="text-xs text-amber-700 dark:text-amber-400">Mode baca — hanya Finance (centang ubah) yang bisa menyimpan.</p>}

      {tab === "alat" ? <TabelAlat d={d} jalankan={jalankan} /> : (
        (tab === "reagen" ? reagen : parameter).length === 0
          ? <EmptyState title="Tidak ada barang yang cocok" description="Ubah kata cari atau filter." />
          : (
            <div className="bg-card overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[1100px] text-sm">
                <thead><tr className="border-b text-left text-xs">
                  <th className="p-2">{tab === "reagen" ? "Analyzer · barang" : "Platform · parameter"}</th><th className="p-2">Kemasan</th>
                  <th className="p-2 text-right">Distributor</th><th className="p-2 text-right">Price list</th>
                  <th className="p-2">Kode barang Accurate</th><th className="p-2">Saran PO terakhir</th>
                  <th className="p-2">Harga beli / kemasan</th><th className="p-2" />
                </tr></thead>
                <tbody>
                  {(tab === "reagen" ? reagen : parameter).map((r) => (
                    <BarisHarga key={`${tab}-${r.id}`} tipe={tab} r={r} boleh={d.bolehUbah} jalankan={jalankan}
                      judul={"analyzer" in r ? `${(r as Reagen).analyzer} · ${r.nama}` : `${(r as Parameter).grup} #${(r as Parameter).no} · ${r.nama}`}
                      sub={"jenis" in r ? (r as Reagen).jenis : (r as Parameter).panel} />
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </div>
  );
}

function BarisHarga({ tipe, r, boleh, jalankan, judul, sub }: {
  tipe: "reagen" | "parameter"; r: Baris; boleh: boolean; judul: string; sub: string | null;
  jalankan: (b: Record<string, unknown>, ok: string) => Promise<void>;
}) {
  const [harga, setHarga] = useState(r.harga_beli == null ? "" : String(r.harga_beli));
  const [item, setItem] = useState(r.accurate_item_no ?? "");
  const tinggi = r.harga_beli != null && r.harga_dp != null && r.harga_beli > r.harga_dp;
  return (
    <tr className="border-b align-top last:border-0">
      <td className="p-2"><div className="font-medium">{judul}</div>{sub && <div className="text-muted-foreground text-xs">{sub}</div>}</td>
      <td className="p-2 text-xs">{r.pack ?? "—"}</td>
      <td className="p-2 text-right tabular-nums">{rp(r.harga_dp)}</td>
      <td className="p-2 text-right tabular-nums">{rp(r.harga_pl)}</td>
      <td className="p-2"><Input className="h-8 w-36" value={item} disabled={!boleh} placeholder="mis. RG-Z52-LYSE" onChange={(e) => setItem(e.target.value)} /></td>
      <td className="p-2 text-xs">
        {r.po_harga != null ? (
          <div>
            <b className="tabular-nums">{rp(r.po_harga)}</b>{r.po_unit ? ` / ${r.po_unit}` : ""}
            <div className="text-muted-foreground">{r.po_number} · {r.po_tanggal}</div>
            {boleh && <button type="button" className="text-primary underline" onClick={() => setHarga(String(r.po_harga))}>pakai</button>}
          </div>
        ) : r.accurate_item_no ? <span className="text-muted-foreground">belum ada PO</span> : <span className="text-muted-foreground">isi kode barang</span>}
      </td>
      <td className="p-2">
        <Input type="number" step="100" className={cn("h-8 w-36 tabular-nums", tinggi && "border-amber-500")} value={harga} disabled={!boleh} onChange={(e) => setHarga(e.target.value)} />
        {tinggi && <div className="text-xs text-amber-700 dark:text-amber-400">di atas harga distributor — cek satuan</div>}
        {r.harga_beli_sumber && <div className="text-muted-foreground text-xs">{r.harga_beli_sumber}</div>}
      </td>
      <td className="p-2">
        {boleh && <Button size="sm" variant="outline" onClick={() => jalankan({
          tipe, id: r.id, harga_beli: harga === "" ? null : Number(harga), accurate_item_no: item || null,
          sumber: r.po_harga != null && Number(harga) === r.po_harga ? "po" : "isian",
        }, "Harga beli tersimpan.")}>Simpan</Button>}
      </td>
    </tr>
  );
}

function TabelAlat({ d, jalankan }: { d: Data; jalankan: (b: Record<string, unknown>, ok: string) => Promise<void> }) {
  return (
    <div className="bg-card overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[800px] text-sm">
        <thead><tr className="border-b text-left text-xs">
          <th className="p-2">Analyzer simulator</th><th className="p-2 text-right">Harga daftar (lama)</th>
          <th className="p-2">Model populasi KSO (F172)</th><th className="p-2 text-right">HPP dipakai</th>
        </tr></thead>
        <tbody>
          {d.analyzer.map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="p-2"><div className="font-medium">{a.label}</div><div className="text-muted-foreground text-xs">{a.kategori} · {a.kode}</div></td>
              <td className="p-2 text-right tabular-nums">{rp(a.default_capex_pl ?? a.default_capex)}</td>
              <td className="p-2">
                <select className={SELECT_CLS} value={a.model_key ?? ""} disabled={!d.bolehUbah}
                  onChange={(e) => jalankan({ tipe: "analyzer", id: a.id, model_key: e.target.value || null }, "Pemetaan alat tersimpan.")}>
                  <option value="">— tidak dipetakan (pakai harga daftar) —</option>
                  {d.model.map((m) => <option key={m.model_key} value={m.model_key}>{m.model} · {m.jenis}</option>)}
                </select>
              </td>
              <td className="p-2 text-right tabular-nums">{rp(a.hpp)}{a.hpp_sumber && <div className="text-muted-foreground text-xs">{a.hpp_sumber}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground p-2 text-xs">HPP diambil dari tab Bottom Line Alat (Komite KSO): HPP standar Finance, atau aset tetap yang nomor serinya cocok. Ubah HPP-nya di sana.</p>
    </div>
  );
}
