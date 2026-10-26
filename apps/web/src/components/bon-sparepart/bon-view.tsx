"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

// F155 Bon Sparepart Teknisi (apps/api/src/repo/bon-sparepart.ts). Gudang mencatat bon di sini;
// teknisi melapor lewat WA #BON; tab Opname = bon dilaporkan vs belum + rekonsiliasi ke SJ Accurate.

type Status = "dibuat" | "dilaporkan" | "selesai" | "batal";
interface Item { urut: number; item_id: number | null; item_no: string | null; item_nama: string; qty: number; satuan: string | null; dilaporkan_qty: number }
interface Bon {
  id: number; kode: string; teknisi_id: string; teknisi_nama: string; asal: "gudang" | "teknisi"; status: Status; customer_nama: string | null; catatan: string | null;
  dibuat_oleh: string; dibuat_at: string; dilaporkan_at: string | null; sj_number: string | null; sj_sumber: "otomatis" | "manual" | null; hari: number; item: Item[];
}
interface Opname { belum_dilaporkan: Bon[]; dilaporkan_belum_sj: Bon[]; tanpa_bon_gudang: Bon[]; selesai: Bon[] }
export interface DataBon { ditautkan: number; opname: Opname; bon: Bon[]; teknisi: { id: string; nama: string }[] }
interface Sparepart { item_id: number; no: string | null; nama: string; satuan: string | null }

const LABEL: Record<Status, string> = { dibuat: "Belum dilaporkan", dilaporkan: "Dilaporkan", selesai: "Sudah jadi SJ", batal: "Batal" };
const CLS: Record<Status, string> = {
  dibuat: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  dilaporkan: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  batal: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
const TANPA_BON = "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
const wkt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");
const qty = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const umur = (h: number) => (h <= 0 ? "hari ini" : `${h} hari lalu`);
const inputCls = "bg-background w-full rounded border px-2 py-1 text-sm";

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch(url, init);
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, data };
}

export function BonView({ awal, bisaUbah }: { awal: DataBon; bisaUbah: boolean }) {
  const [data, setData] = useState<DataBon>(awal);
  const [tab, setTab] = useState<"bon" | "opname">("opname");
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [form, setForm] = useState(false);
  const [tautId, setTautId] = useState<number | null>(null);
  const [kandidat, setKandidat] = useState<{ sj_id: number; number: string }[]>([]);
  const [nomorSj, setNomorSj] = useState("");

  // form bon baru
  const [teknisi, setTeknisi] = useState("");
  const [cust, setCust] = useState("");
  const [catatan, setCatatan] = useState("");
  const [dipilih, setDipilih] = useState<{ sp: Sparepart; qty: string }[]>([]);
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<Sparepart[]>([]);

  async function muat() {
    const r = await api("/api/bon-sparepart", { cache: "no-store" });
    if (r.ok) setData(r.data as unknown as DataBon);
  }

  // Segarkan sendiri tiap 30 dtk supaya #BON dari teknisi muncul tanpa muat ulang. Dilewati saat tab
  // tersembunyi, saat ada aksi berjalan, atau saat panel tautan SJ terbuka (jangan merombak yang sedang
  // dikerjakan). Form bon baru tak terganggu — isinya state terpisah. Gagal = diam, coba lagi di putaran berikut.
  useEffect(() => {
    if (sibuk || tautId !== null) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void fetch("/api/bon-sparepart", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<DataBon>) : null))
        .then((d) => { if (d) setData(d); })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [sibuk, tautId]);
  async function jalankan(fn: () => Promise<string>) {
    setSibuk(true); setPesan(null);
    try { setPesan({ ok: true, teks: await fn() }); await muat(); }
    catch (e) { setPesan({ ok: false, teks: (e as Error).message }); }
    finally { setSibuk(false); }
  }
  const gagal = (d: Record<string, unknown>) => new Error(String(d.error ?? "gagal"));

  async function cari() {
    if (!q.trim()) return;
    const r = await api(`/api/bon-sparepart/sparepart?q=${encodeURIComponent(q.trim())}`);
    setHasil(r.ok ? ((r.data.rows as Sparepart[]) ?? []) : []);
  }
  function tambah(sp: Sparepart) {
    if (!dipilih.some((d) => d.sp.item_id === sp.item_id)) setDipilih([...dipilih, { sp, qty: "1" }]);
    setHasil([]); setQ("");
  }
  async function simpan() {
    await jalankan(async () => {
      const r = await api("/api/bon-sparepart", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ teknisi_id: teknisi, customer_nama: cust, catatan, item: dipilih.map((d) => ({ item_id: d.sp.item_id, qty: Number(d.qty) })) }),
      });
      if (!r.ok) throw gagal(r.data);
      setForm(false); setDipilih([]); setCust(""); setCatatan(""); setTeknisi("");
      return `Bon ${String(r.data.kode)} dicatat — teknisi tinggal melapor lewat #BON.`;
    });
  }
  async function batal(b: Bon) {
    const alasan = prompt(`Alasan membatalkan ${b.kode}?`)?.trim();
    if (!alasan) return;
    await jalankan(async () => {
      const r = await api(`/api/bon-sparepart/${b.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ aksi: "batal", alasan }) });
      if (!r.ok) throw gagal(r.data);
      return `${b.kode} dibatalkan.`;
    });
  }
  async function bukaTaut(b: Bon) {
    if (tautId === b.id) { setTautId(null); return; }
    setTautId(b.id); setNomorSj(""); setKandidat([]);
    const r = await api(`/api/bon-sparepart/${b.id}/sj-kandidat`);
    if (r.ok) setKandidat((r.data.rows as { sj_id: number; number: string }[]) ?? []);
  }
  async function taut(b: Bon, nomor: string) {
    if (!nomor.trim()) return;
    await jalankan(async () => {
      const r = await api(`/api/bon-sparepart/${b.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ aksi: "tautkan", sj_number: nomor.trim() }) });
      if (!r.ok) throw gagal(r.data);
      setTautId(null);
      return `${b.kode} tertaut ke ${nomor.trim()}.`;
    });
  }
  async function rekon() {
    await jalankan(async () => {
      const r = await api("/api/bon-sparepart/rekonsiliasi", { method: "POST" });
      if (!r.ok) throw gagal(r.data);
      return `Rekonsiliasi selesai — ${String(r.data.ditautkan)} bon baru tertaut otomatis.`;
    });
  }

  const o = data.opname;
  const ringkasItem = (b: Bon) => b.item.map((i) => `${i.item_nama} ×${qty(i.qty)}${b.status === "dibuat" && i.dilaporkan_qty > 0 ? ` (${qty(i.dilaporkan_qty)} dilaporkan)` : ""}`).join(", ");

  const panelTaut = (b: Bon) => tautId === b.id && (
    <div className="bg-muted/40 mt-2 space-y-2 rounded border p-2 text-xs">
      {kandidat.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">SJ yang cocok:</span>
          {kandidat.map((k) => (
            <button key={k.sj_id} type="button" disabled={sibuk} onClick={() => void taut(b, k.number)} className="rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50">{k.number}</button>
          ))}
        </div>
      ) : <div className="text-muted-foreground">Tidak ada SJ yang cocok otomatis (item/tanggal/customer) — isi nomor SJ manual.</div>}
      <div className="flex gap-1">
        <input value={nomorSj} onChange={(e) => setNomorSj(e.target.value)} placeholder="Nomor SJ Accurate" className={cn(inputCls, "max-w-64")} />
        <button type="button" disabled={sibuk || !nomorSj.trim()} onClick={() => void taut(b, nomorSj)} className="rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50">Tautkan</button>
      </div>
    </div>
  );

  const aksi = (b: Bon) => bisaUbah && (b.status === "dibuat" || b.status === "dilaporkan") && (
    <div className="flex flex-wrap gap-1">
      <button type="button" disabled={sibuk} onClick={() => void bukaTaut(b)} className="rounded border border-emerald-600 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">Tautkan SJ</button>
      <button type="button" disabled={sibuk} onClick={() => void batal(b)} className="rounded border px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10">Batal</button>
    </div>
  );

  const kolom: DataColumn<Bon>[] = [
    { id: "bon", header: "Bon", sortable: true, accessor: (b) => b.id, cell: (b) => (
      <div>
        <div className="font-semibold">{b.kode}{b.asal === "teknisi" && <span className={cn("ml-1 rounded px-1 text-[10px] font-semibold", TANPA_BON)}>tanpa bon gudang</span>}</div>
        <div className="text-muted-foreground text-xs">{wkt(b.dibuat_at)} · {b.dibuat_oleh}</div>
      </div>) },
    { id: "teknisi", header: "Teknisi", sortable: true, accessor: (b) => b.teknisi_nama, cell: (b) => (
      <div className="min-w-32"><div className="font-medium">{b.teknisi_nama}</div>{b.customer_nama && <div className="text-muted-foreground text-xs">{b.customer_nama}</div>}</div>) },
    { id: "item", header: "Sparepart", cell: (b) => <div className="min-w-56 text-xs">{ringkasItem(b)}{b.catatan && <div className="text-muted-foreground">{b.catatan}</div>}</div> },
    { id: "status", header: "Status", sortable: true, accessor: (b) => ["dibuat", "dilaporkan", "selesai", "batal"].indexOf(b.status), cell: (b) => (
      <div>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", CLS[b.status])}>{LABEL[b.status]}</span>
        <div className="text-muted-foreground mt-0.5 text-xs">{b.status === "selesai" ? `${b.sj_number ?? ""}${b.sj_sumber === "otomatis" ? " · otomatis" : " · manual"}` : b.status === "dilaporkan" ? wkt(b.dilaporkan_at) : umur(b.hari)}</div>
        {panelTaut(b)}
      </div>) },
  ];
  if (bisaUbah) kolom.push({ id: "aksi", header: "Aksi", cell: (b) => aksi(b) });

  const daftar = (judul: string, ket: string, rows: Bon[], tone: string) => (
    <Card>
      <CardContent className="space-y-2 pt-5">
        <div>
          <div className="font-semibold">{judul} <span className={cn("ml-1 rounded px-1.5 text-xs font-bold tabular-nums", tone)}>{rows.length}</span></div>
          <div className="text-muted-foreground text-xs">{ket}</div>
        </div>
        {rows.length === 0 ? <p className="text-muted-foreground text-sm">Tidak ada.</p> : (
          <ul className="divide-y text-sm">
            {rows.map((b) => (
              <li key={b.id} className="py-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><span className="font-semibold">{b.kode}</span> · {b.teknisi_nama} <span className="text-muted-foreground text-xs">— {ringkasItem(b)}</span></div>
                  <div className="text-muted-foreground text-xs">{b.status === "selesai" ? b.sj_number : umur(b.hari)}</div>
                </div>
                {b.status !== "selesai" && <div className="mt-1">{aksi(b)}{panelTaut(b)}</div>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  const kartu: [string, number, string][] = [
    ["Belum dilaporkan", o.belum_dilaporkan.length, CLS.dibuat],
    ["Dilaporkan, SJ belum ada", o.dilaporkan_belum_sj.length, CLS.dilaporkan],
    ["Tanpa bon gudang", o.tanpa_bon_gudang.length, TANPA_BON],
    ["Sudah jadi SJ", o.selesai.length, CLS.selesai],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kartu.map(([t, n, c]) => (
          <div key={t} className="bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]">
            <div className="text-muted-foreground text-xs">{t}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", c)}>{n}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["opname", "bon"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-md border px-3 py-1 text-sm", tab === t ? "border-primary-dark bg-primary/10 font-semibold" : "hover:bg-accent")}>{t === "opname" ? "Opname" : "Semua Bon"}</button>
        ))}
        {bisaUbah && <button type="button" onClick={() => setForm(!form)} className="ml-auto rounded-md border border-emerald-600 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">{form ? "Tutup form" : "+ Bon baru"}</button>}
        {bisaUbah && <button type="button" disabled={sibuk} onClick={() => void rekon()} className="rounded-md border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50">Rekonsiliasi SJ</button>}
      </div>
      {pesan && <p className={cn("text-sm font-medium", pesan.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{pesan.teks}</p>}

      {form && bisaUbah && (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="font-semibold">Bon sparepart baru</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Teknisi
                <select value={teknisi} onChange={(e) => setTeknisi(e.target.value)} className={inputCls}>
                  <option value="">— pilih teknisi —</option>
                  {data.teknisi.map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
                </select>
              </label>
              <label className="text-sm">Customer / tujuan (opsional — membantu mencocokkan SJ)
                <input value={cust} onChange={(e) => setCust(e.target.value)} className={inputCls} />
              </label>
            </div>
            <div className="space-y-1 text-sm">
              <div>Sparepart (cari di master Accurate)</div>
              <div className="flex gap-1">
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void cari(); } }} placeholder="nama atau kode item" className={inputCls} />
                <button type="button" onClick={() => void cari()} className="rounded border px-3 text-sm hover:bg-accent">Cari</button>
              </div>
              {hasil.length > 0 && (
                <ul className="bg-card divide-y rounded border text-sm">
                  {hasil.map((h) => (
                    <li key={h.item_id}><button type="button" onClick={() => tambah(h)} className="hover:bg-accent w-full px-2 py-1 text-left"><span className="font-mono text-xs">{h.no ?? "—"}</span> {h.nama}</button></li>
                  ))}
                </ul>
              )}
            </div>
            {dipilih.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-muted-foreground text-left text-xs"><th>Kode</th><th>Sparepart</th><th className="w-24">Jumlah</th><th /></tr></thead>
                <tbody>
                  {dipilih.map((d, i) => (
                    <tr key={d.sp.item_id} className="border-t">
                      <td className="py-1 font-mono text-xs">{d.sp.no ?? "—"}</td>
                      <td>{d.sp.nama}</td>
                      <td><input type="number" min="1" step="1" value={d.qty} onChange={(e) => setDipilih(dipilih.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className={inputCls} /></td>
                      <td><button type="button" onClick={() => setDipilih(dipilih.filter((_, j) => j !== i))} className="text-xs text-rose-700 hover:underline dark:text-rose-400">hapus</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <label className="block text-sm">Catatan (opsional)<input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputCls} /></label>
            <button type="button" disabled={sibuk || !teknisi || dipilih.length === 0 || dipilih.some((d) => !(Number(d.qty) > 0))} onClick={() => void simpan()}
              className="rounded-md border border-emerald-600 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">Simpan bon</button>
          </CardContent>
        </Card>
      )}

      {tab === "opname" ? (
        <div className="space-y-4">
          <p className="text-muted-foreground text-xs">
            Sama dengan <b>#OPNAME</b> di WhatsApp; diperbarui otomatis tiap 30 detik.Rekonsiliasi menautkan bon yang sudah dilaporkan ke SJ Accurate secara otomatis bila tepat satu SJ cocok
            (item sama, tanggal −1…+14 hari dari laporan, customer sama bila diisi){data.ditautkan ? ` — baru saja: ${data.ditautkan}` : ""}; selebihnya ditautkan manual.
          </p>
          {daftar("Belum dilaporkan teknisi", "Bon gudang yang teknisinya belum (lengkap) melapor #BON.", o.belum_dilaporkan, CLS.dibuat)}
          {daftar("Dilaporkan, SJ belum ada", "Sudah dilaporkan teknisi; belum ada SJ Accurate yang cocok.", o.dilaporkan_belum_sj, CLS.dilaporkan)}
          {daftar("#BON tanpa bon gudang", "Teknisi melapor tetapi gudang belum mencatat bonnya.", o.tanpa_bon_gudang, TANPA_BON)}
          {daftar("Sudah jadi SJ", "Rekonsiliasi selesai (120 hari terakhir).", o.selesai, CLS.selesai)}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataTable columns={kolom} data={data.bon} getKey={(b) => String(b.id)} searchPlaceholder="Cari teknisi / sparepart…" pageSize={25}
              empty="Belum ada bon — catat dengan tombol “+ Bon baru”." />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
