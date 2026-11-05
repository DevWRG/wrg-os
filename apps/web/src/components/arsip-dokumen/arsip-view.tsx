"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { BukuDialog, DetailDialog, UnggahDialog } from "./dialogs";
import { REF, kirim, tgl, type Arsip, type Buku, type DaftarArsip } from "./types";

const HAL = 50;

export function ArsipView({ bolehUnggah, bolehUbah, bolehHapus, bolehAturBuku }: {
  bolehUnggah: boolean; bolehUbah: boolean; bolehHapus: boolean; bolehAturBuku: boolean;
}) {
  const [tab, setTab] = useState<"arsip" | "buku">("arsip");
  const [buku, setBuku] = useState<Buku[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const muatBuku = useCallback(() => {
    kirim<{ items: Buku[] }>("/api/arsip-dokumen/buku").then((x) => { setBuku(x.items); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muatBuku(); }, [muatBuku]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "arsip" | "buku")} className="gap-4">
      <TabsList>
        <TabsTrigger value="arsip">Arsip</TabsTrigger>
        <TabsTrigger value="buku">Kode Buku</TabsTrigger>
      </TabsList>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <TabsContent value="arsip">
        <TabArsip buku={buku} bolehUnggah={bolehUnggah} bolehUbah={bolehUbah} bolehHapus={bolehHapus} />
      </TabsContent>
      <TabsContent value="buku">
        <TabBuku buku={buku} bolehAtur={bolehAturBuku} onBerubah={muatBuku} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------- Arsip

function TabArsip({ buku, bolehUnggah, bolehUbah, bolehHapus }: { buku: Buku[] | null; bolehUnggah: boolean; bolehUbah: boolean; bolehHapus: boolean }) {
  const [d, setD] = useState<DaftarArsip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kode, setKode] = useState("");
  const [periode, setPeriode] = useState("");
  const [offset, setOffset] = useState(0);
  const [unggah, setUnggah] = useState(false);
  const [detail, setDetail] = useState<Arsip | null>(null);
  const [baru, setBaru] = useState<string | null>(null);

  const muat = useCallback(() => {
    const qs = new URLSearchParams({ limit: String(HAL), offset: String(offset) });
    if (q.trim()) qs.set("q", q.trim());
    if (kode) qs.set("buku", kode);
    if (periode) qs.set("periode", periode);
    kirim<DaftarArsip>(`/api/arsip-dokumen?${qs}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [q, kode, periode, offset]);
  useEffect(() => { const t = setTimeout(muat, 250); return () => clearTimeout(t); }, [muat]);

  const bukuOpsi = (buku ?? []).map((b) => ({ value: b.kode, label: `${b.kode} — ${b.nama}` }));
  const adaFilter = Boolean(q.trim() || kode || periode);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-full sm:w-80" placeholder="Cari nomor, judul, faktur, SJ, PO, serial number…" value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <div className="w-60"><Combobox size="sm" value={kode} onChange={(v) => { setKode(v); setOffset(0); }} options={bukuOpsi} emptyOption="Semua buku" placeholder="Semua buku" /></div>
        <Input type="month" className="w-40" aria-label="Bulan dokumen" value={periode} onChange={(e) => { setPeriode(e.target.value); setOffset(0); }} />
        {adaFilter && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setKode(""); setPeriode(""); setOffset(0); }}>Hapus filter</Button>}
        {bolehUnggah && <Button className="ml-auto" onClick={() => setUnggah(true)}>Unggah dokumen</Button>}
      </div>
      {baru && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          Tersimpan dengan nomor <span className="font-mono font-semibold">{baru}</span> — tulis nomor ini di hardfile-nya.
        </div>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : d.items.length === 0 ? (
        <EmptyState
          title={adaFilter ? "Tidak ada dokumen yang cocok" : "Belum ada dokumen"}
          description={adaFilter ? "Coba kata kunci lain, atau hapus filter buku/bulan." : "Unggah scan dokumen pertama — nomor arsip dibuat otomatis."}
        />
      ) : (
        <>
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="p-2">Nomor</th><th className="p-2">Tanggal</th><th className="p-2">Dokumen</th>
                <th className="p-2">Rujukan</th><th className="p-2">Hardfile</th><th className="p-2">Berkas</th><th className="p-2">Diunggah</th>
              </tr></thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id} className="hover:bg-accent cursor-pointer border-b last:border-0" onClick={() => setDetail(r)}>
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{r.nomor}</td>
                    <td className="p-2 whitespace-nowrap">{tgl(r.tanggal_dokumen)}</td>
                    <td className="p-2">
                      <div className="font-medium">{r.judul}</div>
                      <div className="text-muted-foreground text-xs">{r.buku_nama}{r.akun ? ` · ${r.akun}` : ""}</div>
                    </td>
                    <td className="p-2"><Rujukan r={r} /></td>
                    <td className="p-2 text-xs">{r.lokasi_fisik ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <a href={`/api/arsip-dokumen/${r.id}/berkas`} target="_blank" rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline">
                        {r.mime === "application/pdf" ? <FileText className="size-3.5" /> : <ImageIcon className="size-3.5" />}Buka
                      </a>
                    </td>
                    <td className="p-2 text-xs whitespace-nowrap">{tgl(r.diunggah_at)}<div className="text-muted-foreground">{r.diunggah_oleh ?? "—"}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{d.offset + 1}–{d.offset + d.count} dari {d.total_rows} dokumen</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={d.offset === 0} onClick={() => setOffset(Math.max(0, d.offset - HAL))}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={d.offset + d.count >= d.total_rows} onClick={() => setOffset(d.offset + HAL)}>Berikutnya</Button>
            </span>
          </div>
        </>
      )}
      {unggah && buku && (
        <UnggahDialog buku={buku.filter((b) => b.aktif)} onClose={() => setUnggah(false)}
          onTersimpan={(a) => { setUnggah(false); setBaru(a.nomor); setOffset(0); muat(); }} />
      )}
      {detail && (
        <DetailDialog key={detail.id} awal={detail} bolehUbah={bolehUbah} bolehHapus={bolehHapus} onClose={() => setDetail(null)}
          onBerubah={() => { setDetail(null); muat(); }} />
      )}
    </section>
  );
}

function Rujukan({ r }: { r: Arsip }) {
  const ada = REF.filter((x) => r[x.key]);
  if (!ada.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ada.map((x) => (
        <span key={x.key} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-800 dark:text-sky-300">
          {x.key === "ref_sn" ? "SN" : x.key === "ref_faktur" ? "Faktur" : x.key === "ref_sj" ? "SJ" : "PO"} {r[x.key]}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Kode buku

function TabBuku({ buku, bolehAtur, onBerubah }: { buku: Buku[] | null; bolehAtur: boolean; onBerubah: () => void }) {
  const [dialog, setDialog] = useState<Buku | "baru" | null>(null);
  if (!buku) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Kode buku menjadi awal nomor arsip (mis. <span className="font-mono">BKK/2026/11/0001</span>). Urutan nomor mulai dari 0001 lagi tiap bulan per buku.
          {bolehAtur ? " Kode tidak bisa diganti setelah dibuat — nonaktifkan bila tak dipakai lagi." : " Penambahan kode buku diatur admin."}
        </p>
        {bolehAtur && <Button onClick={() => setDialog("baru")}>Tambah kode buku</Button>}
      </div>
      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left">
            <th className="p-2">Kode</th><th className="p-2">Nama</th><th className="p-2">Keterangan</th>
            <th className="p-2 text-right">Dokumen</th><th className="p-2">Status</th>
          </tr></thead>
          <tbody>
            {buku.map((b) => (
              <tr key={b.kode} className={cn("border-b last:border-0", bolehAtur && "hover:bg-accent cursor-pointer")} onClick={() => bolehAtur && setDialog(b)}>
                <td className="p-2 font-mono font-medium">{b.kode}</td>
                <td className="p-2">{b.nama}</td>
                <td className="text-muted-foreground p-2 text-xs">{b.keterangan ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{b.dipakai.toLocaleString("id-ID")}</td>
                <td className="p-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", b.aktif
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-slate-500/15 text-slate-700 dark:text-slate-300")}>
                    {b.aktif ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && <BukuDialog awal={dialog === "baru" ? null : dialog} onClose={() => setDialog(null)} onTersimpan={() => { setDialog(null); onBerubah(); }} />}
    </section>
  );
}
