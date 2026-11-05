"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { kirim, persen, rpJt } from "./types";

// F170 Fase D — Tinjauan Portofolio (Pedoman Komite KSO Forum v01, forum Kamis minggu ke-4).
// Data & izin: GET /api/kso-komite/portofolio (apps/api/src/repo/kso-komite-bottomline.ts → bacaPortofolio,
// izin = lihat Bottom Line). GPM per bulan dihitung API dengan rumus yang sama dengan tab Bottom Line.

type Kondisi = "idle" | "gpm_rendah" | "gpm_pantau" | "piutang" | "gudang";
interface Unit {
  asset_id: string; account_id: string | null; faskes: string | null; cabang: string | null; am_nama: string | null; sn: string | null;
  skema: string | null; jenis: string; model: string; hd: boolean; mulai: string | null; omzet: (number | null)[]; omzet_terakhir: string | null;
  piutang_hari: number | null; piutang_nilai: number | null; biaya_ada: boolean; gpm: (number | null)[]; kondisi: Kondisi[];
  idle_hari: number | null; cicilan_dihitung: boolean;
}
interface Data {
  bulan: string[]; zona: { am: number; hod: number; forum: number }; tenor: number;
  tindakan: Record<Kondisi, { judul: string; tindakan: string; tenggat: string }>;
  ringkasan: { unit: number; di_faskes: number; gpm_tersedia: number; idle: number; gpm_rendah: number; gpm_pantau: number; piutang_faskes: number; gudang: number };
  unit: Unit[];
}

// urutan = paling mendesak dulu (tenggat Pedoman)
const URUT: Kondisi[] = ["piutang", "idle", "gpm_rendah", "gpm_pantau", "gudang"];
const NADA: Record<Kondisi, string> = {
  piutang: "text-red-700 dark:text-red-400", idle: "text-red-700 dark:text-red-400", gpm_rendah: "text-red-700 dark:text-red-400",
  gpm_pantau: "text-amber-700 dark:text-amber-400", gudang: "text-slate-700 dark:text-slate-300",
};
const SELECT_CLS = "rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground";
const bulanPendek = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" }) : "—";

function ChipGpm({ g, z }: { g: number | null; z: Data["zona"] }) {
  if (g == null) return <span className="text-muted-foreground">—</span>;
  const cls = g >= z.am ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : g >= z.hod ? "bg-sky-500/10 text-sky-700 dark:text-sky-400"
    : g >= z.forum ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-red-500/10 text-red-700 dark:text-red-400";
  return <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums", cls)}>{persen(g)}</span>;
}

export function PortofolioPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kondisi, setKondisi] = useState<Kondisi | "">("");
  const [cabang, setCabang] = useState("");
  const [cari, setCari] = useState("");

  useEffect(() => {
    let batal = false;
    kirim<Data>("/api/kso-komite/portofolio").then((x) => { if (!batal) setD(x); }).catch((e: Error) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, []);

  const cabangList = useMemo(() => [...new Set((d?.unit ?? []).map((u) => u.cabang).filter(Boolean) as string[])].sort(), [d]);
  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (d?.unit ?? []).filter((u) => (!cabang || u.cabang === cabang)
      && (!q || [u.faskes, u.model, u.sn, u.am_nama].some((x) => x?.toLowerCase().includes(q))));
  }, [d, cabang, cari]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const r = d.ringkasan;
  const pita: [Kondisi, number, string][] = [
    ["piutang", r.piutang_faskes, "faskes · tahan reagen"], ["idle", r.idle, "unit · relokasi/tarik 30 hari"],
    ["gpm_rendah", r.gpm_rendah, "unit · AM bawa rencana"], ["gpm_pantau", r.gpm_pantau, "unit · tanpa penempatan baru"], ["gudang", r.gudang, "unit · kandidat relokasi"],
  ];
  const judulBulan = [...d.bulan].reverse().map(bulanPendek); // tampil b3 → b1 (lama → baru)

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Alat KSO terpasang dinilai empat kondisi Pedoman Komite KSO Forum v01 — bahan forum Kamis minggu ke-4. {r.unit} unit, {r.di_faskes} di faskes.
        Omzet per unit = omzet faskes per jenis dibagi rata ke unit sejenis; GPM pakai rumus Bottom Line, cicilan alat hanya selama {d.tenor} bulan pertama.
      </p>
      {r.gpm_tersedia === 0 && (
        <p className="rounded-md border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          GPM per customer belum bisa dihitung: biaya reagen per model di tab Bottom Line Alat masih kosong. Kondisi idle dan piutang tetap dinilai.
        </p>
      )}

      <div className="bg-card grid grid-cols-2 overflow-hidden rounded-xl border shadow-[var(--shadow-card)] sm:grid-cols-3 lg:grid-cols-5">
        {pita.map(([k, v, ket]) => (
          <button key={k} type="button" onClick={() => setKondisi(kondisi === k ? "" : k)} aria-pressed={kondisi === k}
            className={cn("border-border border-b p-3 text-left transition-colors hover:bg-accent sm:p-4 lg:border-r lg:border-b-0", kondisi === k && "bg-accent")}>
            <div className={cn("text-2xl font-bold tabular-nums", v === 0 ? "text-muted-foreground" : NADA[k])}>{v}</div>
            <div className="mt-0.5 text-sm font-medium">{d.tindakan[k].judul}</div>
            <div className="text-muted-foreground text-xs">{ket}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">Kondisi
          <select className={SELECT_CLS} value={kondisi} onChange={(e) => setKondisi(e.target.value as Kondisi | "")}>
            <option value="">Semua kondisi</option>
            {URUT.map((k) => <option key={k} value={k}>{d.tindakan[k].judul}</option>)}
          </select>
        </label>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">Cabang
          <select className={SELECT_CLS} value={cabang} onChange={(e) => setCabang(e.target.value)}>
            <option value="">Semua cabang</option>
            {cabangList.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs sm:max-w-xs">Cari faskes / alat / SN / AM
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="mis. Z52, RSUD" />
        </label>
      </div>

      {URUT.filter((k) => !kondisi || k === kondisi).map((k) => {
        const baris = cocok.filter((u) => u.kondisi.includes(k));
        const t = d.tindakan[k];
        return (
          <section key={k} className="space-y-2">
            <div>
              <h2 className="text-base font-semibold">{t.judul} <span className="text-muted-foreground text-sm font-normal tabular-nums">
                {baris.length} unit{k === "piutang" ? ` · ${new Set(baris.map((u) => u.account_id)).size} faskes` : ""}</span></h2>
              <p className="text-muted-foreground text-xs">Tindakan wajib: <span className="text-foreground">{t.tindakan}</span>{t.tenggat !== "—" ? ` · tenggat ${t.tenggat}` : ""}</p>
            </div>
            {baris.length === 0 ? <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">Tidak ada unit di kondisi ini.</p> : (
              <div className="bg-card overflow-x-auto rounded-xl border shadow-[var(--shadow-card)]">
                <table className="w-full min-w-[960px] text-sm">
                  <thead><tr className="border-b text-left text-xs">
                    <th className="p-2">Faskes</th><th className="p-2">Alat</th>
                    <th className="p-2 text-right">Omzet {judulBulan.join(" · ")}</th>
                    <th className="p-2">GPM {judulBulan.join(" · ")}</th>
                    <th className="p-2">Omzet terakhir</th><th className="p-2 text-right">Piutang</th>
                  </tr></thead>
                  <tbody>
                    {baris.map((u) => (
                      <tr key={`${k}-${u.asset_id}`} className="border-b align-top last:border-0">
                        <td className="p-2">
                          <div className="font-medium">{u.faskes ?? "(tanpa faskes)"}</div>
                          <div className="text-muted-foreground text-xs">{[u.cabang, u.am_nama ? `AM ${u.am_nama}` : null].filter(Boolean).join(" · ") || "—"}</div>
                        </td>
                        <td className="p-2">
                          <div>{u.model}</div>
                          <div className="text-muted-foreground text-xs">{[u.jenis, u.sn ? `SN ${u.sn}` : null, u.skema].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="p-2 text-right tabular-nums">{[...u.omzet].reverse().map((o) => (o ? rpJt(o) : "0")).join(" · ")}</td>
                        <td className="p-2">
                          {u.hd ? <span className="text-muted-foreground text-xs">Hemodialisa — tanpa zona</span>
                            : !u.biaya_ada ? <span className="text-muted-foreground text-xs">biaya/HPP belum diisi</span>
                            : <span className="inline-flex gap-1">{[...u.gpm].reverse().map((g, i) => <ChipGpm key={i} g={g} z={d.zona} />)}</span>}
                          {!u.cicilan_dihitung && <div className="text-muted-foreground mt-0.5 text-[11px]">tanpa cicilan alat (lewat {d.tenor} bln)</div>}
                        </td>
                        <td className="p-2 text-xs">
                          {bulanPendek(u.omzet_terakhir)}
                          {u.kondisi.includes("idle") && u.idle_hari != null && <div className="font-medium text-red-700 dark:text-red-400">idle {u.idle_hari} hari</div>}
                        </td>
                        <td className="p-2 text-right text-xs tabular-nums">
                          {u.piutang_hari ? <span className={cn(u.piutang_hari > 90 && "font-semibold text-red-700 dark:text-red-400")}>{u.piutang_hari} hari</span> : "—"}
                          {u.piutang_nilai ? <div className="text-muted-foreground">{rpJt(u.piutang_nilai)}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {cocok.length === 0 && <EmptyState title="Tidak ada unit yang cocok" description="Ubah filter cabang atau kata cari." />}
    </div>
  );
}
