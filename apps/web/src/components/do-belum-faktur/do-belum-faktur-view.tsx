"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, FileClock, Hourglass, Wallet } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton } from "@/components/ui/export-button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// F149 DO Belum Difaktur — bentuk data = apps/api/src/repo/do-belum-faktur.ts.
type Tab = "tagih" | "kso";
interface BarisDo {
  id: number; nomor: string; tanggal: string; status: string; customer: string; cabang: string | null; am: string;
  kategori: string; tab: Tab; baris: number; baris_sisa: number; item_tersinkron: boolean; nilai: number | null;
  umur_hari: number; hari_kerja: number; terlambat: boolean;
}
interface Ringkas { do: number; terlambat: number; nilai: number; tanpa_nilai: number; tertua_hari: number }
interface Daftar {
  ambang_hari_kerja: number; ringkasan: Record<Tab, Ringkas>; cabang_opsi: string[];
  count: number; total_rows: number; limit: number; offset: number; items: BarisDo[];
}

const HAL = 50;
const rp = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
const rpJt = (n: number) => `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
const tgl = (s: string) =>
  new Date(s + "T00:00:00+07:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" });

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}

export function DoBelumFakturView({ bolehUbah }: { bolehUbah: boolean }) {
  const [tab, setTab] = useState<Tab>("tagih");
  const [d, setD] = useState<Daftar | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cabang, setCabang] = useState("");
  const [hanyaTelat, setHanyaTelat] = useState(false);
  const [offset, setOffset] = useState(0);
  const [aturAmbang, setAturAmbang] = useState(false);

  const qs = useCallback((limit: number, off: number) => {
    const p = new URLSearchParams({ tab, limit: String(limit), offset: String(off) });
    if (q.trim()) p.set("q", q.trim());
    if (cabang) p.set("cabang", cabang);
    if (hanyaTelat && tab === "tagih") p.set("hanya_terlambat", "1");
    return p;
  }, [tab, q, cabang, hanyaTelat]);

  const muat = useCallback(() => {
    kirim<Daftar>(`/api/do-belum-faktur?${qs(HAL, offset)}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [qs, offset]);
  useEffect(() => { const t = setTimeout(muat, 250); return () => clearTimeout(t); }, [muat]);

  const gantiTab = (v: Tab) => { setTab(v); setOffset(0); setCabang(""); setHanyaTelat(false); };
  const r = d?.ringkasan[tab];

  return (
    <section className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => gantiTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="tagih">Perlu ditagih{d ? ` (${d.ringkasan.tagih.do})` : ""}</TabsTrigger>
          <TabsTrigger value="kso">KSO — ditagih bulanan{d ? ` (${d.ringkasan.kso.do})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "kso" ? (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900 dark:text-sky-200">
          DO yang <b>seluruh barangnya kategori KSO</b>. Penagihan KSO dibuat bulanan dari form perhitungan KSO, bukan per DO — jadi status DO-nya di Accurate memang tetap “Dikirim”. Tab ini hanya informasi dan <b>tidak dihitung terlambat</b>.
        </div>
      ) : d && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span>Terlambat = lewat <b>{d.ambang_hari_kerja} hari kerja</b> sejak tanggal DO (Sabtu, Minggu, dan hari di Kalender Libur tidak dihitung).</span>
          {bolehUbah && <Button size="sm" variant="outline" onClick={() => setAturAmbang(true)}>Ubah ambang</Button>}
        </div>
      )}

      {r && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="DO belum difaktur" value={r.do.toLocaleString("id-ID")} icon={FileClock} />
          <StatCard title={tab === "kso" ? "Terlambat (tidak dihitung)" : "Terlambat"} value={tab === "kso" ? "—" : r.terlambat.toLocaleString("id-ID")}
            deltaTone={r.terlambat ? "negative" : "neutral"} delta={tab === "tagih" && r.do ? `${Math.round((r.terlambat / r.do) * 100)}% dari DO tertunda` : undefined} icon={AlarmClock} />
          <StatCard title="Perkiraan nilai (netto, harga SO)" value={rpJt(r.nilai)} delta={r.tanpa_nilai ? `${r.tanpa_nilai} DO tanpa nilai` : undefined} icon={Wallet} />
          <StatCard title="DO tertua" value={`${r.tertua_hari} hari`} icon={Hourglass} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-full sm:w-72" placeholder="Cari nomor DO, customer, atau AM…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <div className="w-52">
          <Combobox size="sm" value={cabang} onChange={(v) => { setCabang(v); setOffset(0); }} emptyOption="Semua cabang" placeholder="Semua cabang"
            options={(d?.cabang_opsi ?? []).map((c) => ({ value: c, label: c }))} />
        </div>
        {tab === "tagih" && (
          <Button size="sm" variant={hanyaTelat ? "default" : "outline"} onClick={() => { setHanyaTelat(!hanyaTelat); setOffset(0); }}>Hanya terlambat</Button>
        )}
        <div className="ml-auto">
          <ExportButton<BarisDo>
            filename={`do-belum-difaktur-${tab}`}
            fetchData={async () => (await kirim<Daftar>(`/api/do-belum-faktur?${qs(1000, 0)}`)).items}
            columns={[
              { header: "No. DO", value: (x) => x.nomor },
              { header: "Tanggal DO", value: (x) => x.tanggal },
              { header: "Status Accurate", value: (x) => x.status },
              { header: "Customer", value: (x) => x.customer },
              { header: "Cabang", value: (x) => x.cabang ?? "" },
              { header: "AM", value: (x) => x.am },
              { header: "Kategori", value: (x) => x.kategori },
              { header: "Umur (hari)", value: (x) => x.umur_hari },
              { header: "Hari kerja", value: (x) => x.hari_kerja },
              { header: "Terlambat", value: (x) => (x.terlambat ? "Ya" : "") },
              { header: "Baris belum difaktur", value: (x) => x.baris_sisa },
              { header: "Perkiraan nilai netto", value: (x) => x.nilai },
            ]}
          />
        </div>
      </div>

      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : d.items.length === 0 ? (
        <EmptyState title="Tidak ada DO yang cocok" description={tab === "tagih" ? "Semua DO yang sudah dikirim sudah difakturkan — atau coba hapus filter." : "Tidak ada DO KSO yang menunggu."} />
      ) : (
        <>
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="p-2">No. DO</th><th className="p-2">Tanggal</th><th className="p-2">Customer</th><th className="p-2">AM / cabang</th>
                <th className="p-2">Kategori</th><th className="p-2 text-right">Umur</th><th className="p-2 text-right">Perkiraan nilai</th>
              </tr></thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.id} className="border-b last:border-0">
                    <td className="p-2 whitespace-nowrap">
                      <div className="font-mono text-xs">{x.nomor}</div>
                      {x.status !== "Dikirim" && <div className="text-xs text-sky-700 dark:text-sky-400">{x.status} · {x.baris_sisa} dari {x.baris} baris belum</div>}
                    </td>
                    <td className="p-2 whitespace-nowrap">{tgl(x.tanggal)}</td>
                    <td className="p-2">{x.customer}</td>
                    <td className="p-2"><div>{x.am}</div><div className="text-muted-foreground text-xs">{x.cabang ?? "Tanpa cabang"}</div></td>
                    <td className="p-2 text-xs">{x.kategori}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                        x.terlambat ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-slate-500/15 text-slate-700 dark:text-slate-300")}>
                        {x.hari_kerja} hari kerja
                      </span>
                      <div className="text-muted-foreground mt-0.5 text-xs">{x.umur_hari} hari kalender</div>
                    </td>
                    <td className="p-2 text-right tabular-nums whitespace-nowrap">
                      {x.item_tersinkron ? rp(x.nilai) : <span className="text-xs text-amber-700 dark:text-amber-400">item belum tersalin</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{d.offset + 1}–{d.offset + d.count} dari {d.total_rows} DO</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={d.offset === 0} onClick={() => setOffset(Math.max(0, d.offset - HAL))}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={d.offset + d.count >= d.total_rows} onClick={() => setOffset(d.offset + HAL)}>Berikutnya</Button>
            </span>
          </div>
        </>
      )}
      {aturAmbang && d && <AmbangDialog awal={d.ambang_hari_kerja} onClose={() => setAturAmbang(false)} onTersimpan={() => { setAturAmbang(false); muat(); }} />}
    </section>
  );
}

function AmbangDialog({ awal, onClose, onTersimpan }: { awal: number; onClose: () => void; onTersimpan: () => void }) {
  const [v, setV] = useState(String(awal));
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const simpan = async () => {
    setSibuk(true); setErr(null);
    try {
      await kirim("/api/do-belum-faktur/param", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ambang_hari_kerja: Number(v) }) });
      onTersimpan();
    } catch (e) { setErr((e as Error).message); setSibuk(false); }
  };
  return (
    <div className="bg-card space-y-3 rounded-lg border p-3">
      <div className="text-sm font-medium">Ambang terlambat (hari kerja sejak tanggal DO)</div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" min={0} max={60} className="w-24" value={v} onChange={(e) => setV(e.target.value)} aria-label="Ambang hari kerja" />
        <Button size="sm" onClick={simpan} disabled={sibuk}>{sibuk ? "Menyimpan…" : "Simpan"}</Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={sibuk}>Batal</Button>
      </div>
      <p className="text-muted-foreground text-xs">SOP Fakturis: faktur terbit paling lambat H+1 hari kerja dari permintaan. Bawaan 3 hari kerja memberi ruang dokumen kembali dari kurir.</p>
      {err && <p className="text-destructive text-sm">{err}</p>}
    </div>
  );
}
