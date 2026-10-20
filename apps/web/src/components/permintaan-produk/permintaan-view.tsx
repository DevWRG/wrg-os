"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { CatatDialog, ParamDialog, PutusDialog, UsulDialog } from "./dialogs";
import {
  CLS_CEK, LABEL_CEK, LABEL_KEPUTUSAN, kirim, rp, rpJt, tgl,
  type Analisa, type Cek, type DaftarLog, type DaftarReview, type Kelompok, type Opsi, type Permintaan, type Review,
} from "./types";

type Tab = "log" | "analisa" | "review";
const HAL = 50;

export function PermintaanView({ bolehCatat, bolehUbah, bolehPutus }: { bolehCatat: boolean; bolehUbah: boolean; bolehPutus: boolean }) {
  const [tab, setTab] = useState<Tab>("log");
  const [opsi, setOpsi] = useState<Opsi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const muatOpsi = useCallback(() => { kirim<Opsi>("/api/permintaan-produk/opsi").then(setOpsi).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { muatOpsi(); }, [muatOpsi]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
      <TabsList>
        <TabsTrigger value="log">Log</TabsTrigger>
        <TabsTrigger value="analisa">Analisa</TabsTrigger>
        <TabsTrigger value="review">Review Kuartal</TabsTrigger>
      </TabsList>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <TabsContent value="log"><TabLog opsi={opsi} bolehCatat={bolehCatat} bolehUbah={bolehUbah} onKelompokBaru={muatOpsi} /></TabsContent>
      <TabsContent value="analisa"><TabAnalisa aktif={tab === "analisa"} bolehUbah={bolehUbah} bolehPutus={bolehPutus} /></TabsContent>
      <TabsContent value="review"><TabReview aktif={tab === "review"} bolehPutus={bolehPutus} /></TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------- Log

function TabLog({ opsi, bolehCatat, bolehUbah, onKelompokBaru }: { opsi: Opsi | null; bolehCatat: boolean; bolehUbah: boolean; onKelompokBaru: () => void }) {
  const [d, setD] = useState<DaftarLog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cek, setCek] = useState("");
  const [kel, setKel] = useState("");
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<Permintaan | "baru" | null>(null);

  const muat = useCallback(() => {
    const qs = new URLSearchParams({ limit: String(HAL), offset: String(offset) });
    if (q.trim()) qs.set("q", q.trim());
    if (cek) qs.set("cek", cek);
    if (kel) qs.set("kelompok_id", kel);
    kirim<DaftarLog>(`/api/permintaan-produk?${qs}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [q, cek, kel, offset]);
  useEffect(() => { const t = setTimeout(muat, 250); return () => clearTimeout(t); }, [muat]);

  const cekOpsi = [{ value: "", label: "Semua status" }, ...(Object.keys(LABEL_CEK) as Cek[]).map((k) => ({ value: k, label: LABEL_CEK[k] }))];
  const kelOpsi = [{ value: "", label: "Semua kelompok" }, ...(opsi?.kelompok ?? []).map((k) => ({ value: String(k.id), label: k.nama }))];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-full sm:w-64" placeholder="Cari produk, faskes, merek…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <div className="w-44"><Combobox size="sm" value={cek} onChange={(v) => { setCek(v); setOffset(0); }} options={cekOpsi} /></div>
        <div className="w-56"><Combobox size="sm" value={kel} onChange={(v) => { setKel(v); setOffset(0); }} options={kelOpsi} /></div>
        {bolehCatat && <Button className="ml-auto" onClick={() => setDialog("baru")}>Catat permintaan</Button>}
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : d.items.length === 0 ? (
        <EmptyState title="Belum ada permintaan" description="Catat permintaan produk di luar master SKU yang disampaikan AM, HoD, atau teknisi." />
      ) : (
        <>
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="p-2">Tanggal</th><th className="p-2">Produk diminta</th><th className="p-2">Faskes</th>
                <th className="p-2 text-right">Qty/bln</th><th className="p-2 text-right">Harga</th><th className="p-2">Cek master</th>
                <th className="p-2">Kelompok</th><th className="p-2">Dicatat</th>
              </tr></thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id} className={cn("border-b last:border-0", bolehUbah && "hover:bg-accent cursor-pointer")} onClick={() => bolehUbah && setDialog(r)}>
                    <td className="p-2 whitespace-nowrap">{tgl(r.tanggal_minta)}</td>
                    <td className="p-2"><div className="font-medium">{r.produk_diminta}</div>{r.merek && <div className="text-muted-foreground text-xs">{r.merek}</div>}</td>
                    <td className="p-2"><div>{r.faskes_nama}</div><div className="text-muted-foreground text-xs">{r.pengaju}{r.account_id ? "" : " · calon pelanggan"}</div></td>
                    <td className="p-2 text-right tabular-nums">{r.qty_bulan ?? "—"}{r.qty_bulan != null && r.satuan ? ` ${r.satuan}` : ""}</td>
                    <td className="p-2 text-right tabular-nums">{rp(r.harga_satuan)}</td>
                    <td className="p-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", CLS_CEK[r.cek_master])}>{LABEL_CEK[r.cek_master]}</span>
                      {r.sku_nama && <div className="text-muted-foreground mt-0.5 text-xs">{r.sku_nama}</div>}
                    </td>
                    <td className="p-2 text-xs">{r.kelompok_nama ?? <span className="text-amber-700 dark:text-amber-400">belum dikelompokkan</span>}</td>
                    <td className="p-2 text-xs whitespace-nowrap">
                      {tgl(r.dicatat_at)}
                      {r.terlambat && <div className="font-medium text-red-700 dark:text-red-400">lewat {d.sla_hari_kerja} hari kerja</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{d.offset + 1}–{d.offset + d.count} dari {d.total_rows} permintaan</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={d.offset === 0} onClick={() => setOffset(Math.max(0, d.offset - HAL))}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={d.offset + d.count >= d.total_rows} onClick={() => setOffset(d.offset + HAL)}>Berikutnya</Button>
            </span>
          </div>
        </>
      )}
      {dialog && opsi && (
        <CatatDialog key={dialog === "baru" ? "baru" : dialog.id} awal={dialog === "baru" ? null : dialog} opsi={opsi} bolehUbah={bolehUbah}
          onClose={() => setDialog(null)} onTersimpan={() => { setDialog(null); muat(); }} onKelompokBaru={onKelompokBaru} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Analisa

function TabAnalisa({ aktif, bolehUbah, bolehPutus }: { aktif: boolean; bolehUbah: boolean; bolehPutus: boolean }) {
  const [d, setD] = useState<Analisa | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [usul, setUsul] = useState<Kelompok | null>(null);
  const [atur, setAtur] = useState(false);
  const muat = useCallback(() => { kirim<Analisa>("/api/permintaan-produk/analisa").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { if (aktif) muat(); }, [aktif, muat]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const p = d.param;
  const kandidat = d.kelompok.filter((k) => k.kandidat).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
        <span>
          <b>Kandidat review</b> = ≥ {p.kandidat_min_faskes} faskes berbeda dalam {p.kandidat_hari} hari <b>dan</b> potensi ≥ {rpJt(p.kandidat_min_potensi)}/tahun.
          Potensi = qty per bulan × harga × 12, memakai permintaan terbaru tiap faskes. Permintaan yang produknya <b>ada di master</b> tidak dihitung.
        </span>
        {bolehPutus && <Button size="sm" variant="outline" onClick={() => setAtur(true)}>Ubah ambang</Button>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Kelompok", d.kelompok.length], ["Kandidat", kandidat], ["Belum dikelompokkan", d.tanpa_kelompok],
          ["Permintaan bulan ini", d.tren.find((t) => t.bulan === d.hari_ini.slice(0, 7))?.permintaan ?? 0]].map(([l, v]) => (
          <div key={String(l)} className="bg-card rounded-lg border p-3">
            <div className="text-muted-foreground text-xs">{l}</div>
            <div className="mt-1 text-lg font-bold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {d.tanpa_kelompok > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">{d.tanpa_kelompok} permintaan non-master belum masuk kelompok — tidak ikut analisa sampai dikelompokkan di tab Log.</p>
      )}
      {d.kelompok.length === 0 ? <EmptyState title="Belum ada kelompok" description="Kelompokkan permintaan di tab Log (buka baris → Kelompok)." /> : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Kelompok</th><th className="p-2 text-right">Faskes ({p.kandidat_hari} hr)</th><th className="p-2 text-right">Permintaan</th>
              <th className="p-2 text-right">Harga median</th><th className="p-2 text-right">Potensi/tahun</th><th className="p-2">Status</th><th className="p-2" />
            </tr></thead>
            <tbody>
              {d.kelompok.map((k) => (
                <tr key={k.id} className="border-b last:border-0">
                  <td className="p-2">
                    <div className="font-medium">{k.nama}</div>
                    <div className="text-muted-foreground text-xs">
                      belum ada {k.belum_ada} · substitusi {k.substitusi}{k.belum_dicek ? ` · belum dicek ${k.belum_dicek}` : ""} · total {k.total_semua}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{k.faskes_unik}</td>
                  <td className="p-2 text-right tabular-nums">{k.permintaan}</td>
                  <td className="p-2 text-right tabular-nums">{rp(k.harga_median)}</td>
                  <td className="p-2 text-right tabular-nums">
                    {k.potensi_tahun == null ? <span className="text-muted-foreground text-xs">belum ada angka</span> : rpJt(k.potensi_tahun)}
                    {k.faskes_tanpa_angka > 0 && k.potensi_tahun != null && <div className="text-muted-foreground text-xs">{k.faskes_tanpa_angka} faskes tanpa qty/harga</div>}
                  </td>
                  <td className="p-2 text-xs">
                    {k.kandidat && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">Kandidat</span>}
                    {k.review_terakhir && (
                      <div className="mt-0.5">{k.review_terakhir.kuartal}: {k.review_terakhir.putusan
                        ? <b>{LABEL_KEPUTUSAN[k.review_terakhir.putusan]}</b> : `diusulkan ${LABEL_KEPUTUSAN[k.review_terakhir.usulan]}`}</div>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {bolehUbah && !k.review_terakhir?.putusan && <Button size="sm" variant={k.kandidat ? "default" : "outline"} onClick={() => setUsul(k)}>Usulkan</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.tren.length > 0 && (
        <div className="text-muted-foreground text-xs">Tren permintaan non-master: {d.tren.map((t) => `${t.bulan} ${t.permintaan} (${t.faskes} faskes)`).join(" · ")}</div>
      )}
      {usul && <UsulDialog k={usul} onClose={() => setUsul(null)} onTersimpan={() => { setUsul(null); muat(); }} />}
      {atur && <ParamDialog p={p} onClose={() => setAtur(false)} onTersimpan={() => { setAtur(false); muat(); }} />}
    </section>
  );
}

// ---------------------------------------------------------------- Review kuartal

function TabReview({ aktif, bolehPutus }: { aktif: boolean; bolehPutus: boolean }) {
  const [d, setD] = useState<DaftarReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [putus, setPutus] = useState<Review | null>(null);
  const muat = useCallback(() => { kirim<DaftarReview>("/api/permintaan-produk/review").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(() => { if (aktif) muat(); }, [aktif, muat]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!d) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const kuartal = [...new Set(d.items.map((r) => r.kuartal))];
  if (kuartal.length === 0) return <EmptyState title="Belum ada usulan" description={`Usulan Komite PD untuk ${d.kuartal_sekarang} dibuat dari tab Analisa (tombol Usulkan).`} />;
  return (
    <section className="space-y-4">
      {kuartal.map((kq) => (
        <div key={kq} className="space-y-2">
          <h2 className="font-semibold">{kq}{kq === d.kuartal_sekarang ? " · kuartal berjalan" : ""}</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {d.items.filter((r) => r.kuartal === kq).map((r) => (
              <li key={r.id} className="bg-card space-y-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.kelompok_nama}</span>
                  {r.putusan
                    ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">Diputus: {LABEL_KEPUTUSAN[r.putusan]}</span>
                    : <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">Menunggu Direksi</span>}
                </div>
                <div className="text-muted-foreground text-xs">
                  Saat diusulkan: {r.snapshot.faskes_unik ?? "—"} faskes · potensi {rpJt(r.snapshot.potensi_tahun ?? null)} · harga median {rp(r.snapshot.harga_median ?? null)}
                </div>
                <div><b>Usulan Komite PD:</b> {LABEL_KEPUTUSAN[r.usulan]} — {r.usulan_catatan} <span className="text-muted-foreground text-xs">({r.usulan_oleh}, {tgl(r.usulan_at)})</span></div>
                {r.putusan && <div><b>Putusan Direksi:</b> {LABEL_KEPUTUSAN[r.putusan]} — {r.putusan_catatan} <span className="text-muted-foreground text-xs">({r.putusan_oleh}, {tgl(r.putusan_at)})</span></div>}
                {!r.putusan && bolehPutus && <Button size="sm" onClick={() => setPutus(r)}>Putuskan</Button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {putus && <PutusDialog r={putus} onClose={() => setPutus(null)} onTersimpan={() => { setPutus(null); muat(); }} />}
    </section>
  );
}
