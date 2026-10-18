"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

// F154 Jadwal Kunjungan Rutin Teknisi (apps/api/src/repo/jadwal-teknisi.ts). Penyusunan
// & aturan di server; di sini HoD Aftersales meninjau, mengedit, dan menerbitkan.

interface Teknisi { id: string; nama: string; panggilan: string | null; ada_wa: boolean }
interface Baris {
  id: string; tanggal: string; urutan: number; teknisi_id: string | null; teknisi: string | null; account_id: string; faskes: string;
  wilayah: string | null; alat: { sn: string; nama: string; skema: string }[]; status: "rencana" | "selesai" | "batal"; sumber: string; catatan: string | null;
}
export interface DataJadwal {
  bulan: string; status: "draft" | "terbit" | null; disusun_at: string | null; terbit_at: string | null; terbit_oleh: string | null;
  hari_kerja: string[]; kalender_libur_ada: boolean; baris: Baris[]; teknisi: Teknisi[];
}
interface Pratinjau { populasi: number; jatuh_tempo: number; hari_kerja: number; melebihi: number; per_wilayah: { wilayah: string; faskes: number }[]; per_teknisi: { teknisi: string; kunjungan: number; hari: number }[] }
interface Wilayah { wilayah: string; faskes: number; alat: number; teknisi_id: string | null }
interface Frekuensi { account_id: string; nama: string; wilayah: string; skema: string[]; alat: number; interval_default: number; interval_bulan: number | null; terakhir: string | null }

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const lblBulan = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${BLN[m - 1]} ${y}`; };
const lblTgl = (iso: string) => { const t = new Date(`${iso}T00:00:00Z`); return `${HARI[t.getUTCDay()]} ${t.getUTCDate()} ${BLN[t.getUTCMonth()]}`; };
const geserBulan = (iso: string, n: number) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
const STATUS_CLS: Record<Baris["status"], string> = {
  rencana: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  batal: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
const SEL = "rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50";

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
  return d as T;
}

export function JadwalTeknisiView({ awal, bisaUbah }: { awal: DataJadwal | null; bisaUbah: boolean }) {
  const [tab, setTab] = useState<"jadwal" | "wilayah" | "frekuensi">("jadwal");
  const [data, setData] = useState<DataJadwal | null>(awal);
  const [prev, setPrev] = useState<Pratinjau | null>(null);
  const [wil, setWil] = useState<{ wilayah: Wilayah[]; teknisi: Teknisi[] } | null>(null);
  const [frek, setFrek] = useState<Frekuensi[] | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [fTeknisi, setFTeknisi] = useState("");
  const [fStatus, setFStatus] = useState("");

  async function jalan<T>(f: () => Promise<T>, ok?: (r: T) => string) {
    setSibuk(true); setPesan(null);
    try { const r = await f(); if (ok) setPesan({ ok: true, teks: ok(r) }); return r; }
    catch (e) { setPesan({ ok: false, teks: (e as Error).message }); return null; }
    finally { setSibuk(false); }
  }
  const muat = (bulan: string) => jalan(async () => { setData(await api<DataJadwal>(`/api/jadwal-teknisi?bulan=${bulan}`)); setPrev(null); });
  const bukaTab = async (t: typeof tab) => {
    setTab(t);
    if (t === "wilayah" && !wil) await jalan(async () => setWil(await api(`/api/jadwal-teknisi/wilayah`)));
    if (t === "frekuensi" && !frek) await jalan(async () => setFrek((await api<{ faskes: Frekuensi[] }>(`/api/jadwal-teknisi/frekuensi`)).faskes));
  };

  const bulan = data?.bulan ?? "";
  const tekNama = useMemo(() => new Map((data?.teknisi ?? []).map((t) => [t.id, t.nama])), [data]);
  const opsiTek = (data?.teknisi ?? wil?.teknisi ?? []).map((t) => ({ value: t.id, label: t.nama }));
  const baris = (data?.baris ?? []).filter((b) => (!fTeknisi || (fTeknisi === "__kosong" ? !b.teknisi_id : b.teknisi_id === fTeknisi)) && (!fStatus || b.status === fStatus));
  const tanpaTeknisi = (data?.baris ?? []).filter((b) => !b.teknisi_id && b.status !== "batal").length;
  const perTek = useMemo(() => {
    const m = new Map<string, { nama: string; n: number; hari: Set<string> }>();
    for (const b of data?.baris ?? []) {
      if (b.status === "batal") continue;
      const k = b.teknisi_id ?? "";
      const x = m.get(k) ?? { nama: b.teknisi ?? "(belum ada teknisi)", n: 0, hari: new Set<string>() };
      x.n += 1; x.hari.add(b.tanggal); m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [data]);

  async function ubah(b: Baris, isi: Record<string, unknown>) {
    const r = await jalan(() => api(`/api/jadwal-teknisi/baris/${b.id}`, "PATCH", isi));
    if (r) await muat(bulan);
  }

  const kolom: DataColumn<Baris>[] = [
    { id: "tgl", header: "Tanggal", sortable: true, accessor: (b) => `${b.tanggal}-${b.urutan}`, cell: (b) => bisaUbah && b.status !== "selesai"
      ? <select className={SEL} value={b.tanggal} disabled={sibuk} onChange={(e) => void ubah(b, { tanggal: e.target.value })}>
          {(data?.hari_kerja.includes(b.tanggal) ? data.hari_kerja : [b.tanggal, ...(data?.hari_kerja ?? [])]).map((h) => <option key={h} value={h}>{lblTgl(h)}</option>)}
        </select>
      : <span className="tabular-nums">{lblTgl(b.tanggal)}</span> },
    { id: "faskes", header: "Faskes", sortable: true, accessor: (b) => b.faskes, cell: (b) => (
      <div className="min-w-48">
        <Link href={`/accounts/${b.account_id}`} className="font-medium hover:underline">{b.faskes}</Link>
        <div className="text-muted-foreground text-xs">{[b.wilayah, `${b.alat.length} alat`, b.sumber === "manual" ? "diubah manual" : null].filter(Boolean).join(" · ")}</div>
        {b.catatan && <div className="text-xs text-amber-700 dark:text-amber-400">{b.catatan}</div>}
      </div>) },
    { id: "alat", header: "Alat", cell: (b) => <div className="text-muted-foreground max-w-56 text-xs">{b.alat.slice(0, 3).map((a) => a.nama).join(", ")}{b.alat.length > 3 ? ` +${b.alat.length - 3}` : ""}</div> },
    { id: "teknisi", header: "Teknisi", sortable: true, accessor: (b) => b.teknisi ?? "", cell: (b) => bisaUbah && b.status !== "selesai"
      ? <select className={cn(SEL, !b.teknisi_id && "border-amber-500")} value={b.teknisi_id ?? ""} disabled={sibuk} onChange={(e) => void ubah(b, { teknisi_id: e.target.value || null })}>
          <option value="">— pilih teknisi —</option>
          {opsiTek.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      : <span>{b.teknisi ?? <span className="text-amber-700 dark:text-amber-400">belum ada</span>}</span> },
    { id: "status", header: "Status", sortable: true, accessor: (b) => b.status, cell: (b) => bisaUbah
      ? <select className={cn(SEL, STATUS_CLS[b.status])} value={b.status} disabled={sibuk} onChange={(e) => void ubah(b, { status: e.target.value })}>
          <option value="rencana">Rencana</option><option value="selesai">Selesai</option><option value="batal">Batal</option>
        </select>
      : <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[b.status])}>{b.status}</span> },
  ];

  const kolomWil: DataColumn<Wilayah>[] = [
    { id: "w", header: "Wilayah", sortable: true, accessor: (w) => w.wilayah, cell: (w) => <span className="font-medium">{w.wilayah}</span> },
    { id: "f", header: "Faskes KSO", align: "right", sortable: true, accessor: (w) => w.faskes, cell: (w) => <span className="tabular-nums">{w.faskes}</span> },
    { id: "a", header: "Alat", align: "right", sortable: true, accessor: (w) => w.alat, cell: (w) => <span className="tabular-nums">{w.alat}</span> },
    { id: "t", header: "Teknisi", cell: (w) => bisaUbah
      ? <select className={cn(SEL, !w.teknisi_id && "border-amber-500")} value={w.teknisi_id ?? ""} disabled={sibuk}
          onChange={async (e) => { const r = await jalan(() => api(`/api/jadwal-teknisi/wilayah`, "PUT", { wilayah: w.wilayah, teknisi_id: e.target.value || null }), () => `Wilayah ${w.wilayah} disimpan`);
            if (r && wil) setWil({ ...wil, wilayah: wil.wilayah.map((x) => x.wilayah === w.wilayah ? { ...x, teknisi_id: e.target.value || null } : x) }); }}>
          <option value="">— belum ditetapkan —</option>
          {(wil?.teknisi ?? []).map((t) => <option key={t.id} value={t.id}>{t.nama}{t.ada_wa ? "" : " (tanpa WA)"}</option>)}
        </select>
      : <span>{w.teknisi_id ? tekNama.get(w.teknisi_id) ?? w.teknisi_id : "—"}</span> },
  ];
  const kolomFrek: DataColumn<Frekuensi>[] = [
    { id: "n", header: "Faskes", sortable: true, accessor: (f) => f.nama, cell: (f) => (
      <div><Link href={`/accounts/${f.account_id}`} className="font-medium hover:underline">{f.nama}</Link><div className="text-muted-foreground text-xs">{f.wilayah} · {f.alat} alat · {f.skema.join(", ")}</div></div>) },
    { id: "i", header: "Kunjungan rutin", sortable: true, accessor: (f) => f.interval_bulan ?? f.interval_default, cell: (f) => bisaUbah
      ? <select className={SEL} value={f.interval_bulan ?? ""} disabled={sibuk}
          onChange={async (e) => { const v = e.target.value ? Number(e.target.value) : null;
            const r = await jalan(() => api(`/api/jadwal-teknisi/frekuensi`, "PUT", { account_id: Number(f.account_id), interval_bulan: v }), () => `Frekuensi ${f.nama} disimpan`);
            if (r && frek) setFrek(frek.map((x) => x.account_id === f.account_id ? { ...x, interval_bulan: v } : x)); }}>
          <option value="">Default — tiap {f.interval_default} bulan</option>
          {[1, 2, 3, 4, 6, 12].map((n) => <option key={n} value={n}>Tiap {n} bulan</option>)}
        </select>
      : <span>Tiap {f.interval_bulan ?? f.interval_default} bulan{f.interval_bulan ? "" : " (default)"}</span> },
    { id: "t", header: "Kunjungan rutin terakhir", sortable: true, accessor: (f) => f.terakhir ?? "", cell: (f) => <span className="tabular-nums">{f.terakhir ? lblBulan(f.terakhir) : "—"}</span> },
  ];

  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Bagian jadwal teknisi">
            {([["jadwal", "Jadwal bulanan"], ["wilayah", "Wilayah teknisi"], ["frekuensi", "Frekuensi per faskes"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => void bukaTab(k)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium transition-colors", tab === k ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent")}>{l}</button>
            ))}
          </div>
          {sibuk && <span className="text-muted-foreground text-xs">Memproses…</span>}
          {pesan && <span className={cn("text-xs", pesan.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{pesan.teks}</span>}
        </CardContent>
      </Card>

      {tab === "jadwal" && data && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 py-3">
              <button type="button" disabled={sibuk} onClick={() => void muat(geserBulan(bulan, -1))} className="rounded-md border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50">‹</button>
              <div className="min-w-28 text-center font-semibold">{lblBulan(bulan)}</div>
              <button type="button" disabled={sibuk} onClick={() => void muat(geserBulan(bulan, 1))} className="rounded-md border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50">›</button>
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", data.status === "terbit" ? STATUS_CLS.selesai : data.status === "draft" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : STATUS_CLS.batal)}>
                {data.status === "terbit" ? "Terbit" : data.status === "draft" ? "Draft" : "Belum disusun"}
              </span>
              {bisaUbah && data.status !== "terbit" && <>
                <button type="button" disabled={sibuk} onClick={() => void jalan(async () => setPrev(await api(`/api/jadwal-teknisi/pratinjau?bulan=${bulan}`)))} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">Pratinjau</button>
                <button type="button" disabled={sibuk} onClick={async () => { if (data.baris.length && !confirm("Susun ulang? Baris otomatis yang belum diubah akan dihitung ulang; baris yang sudah Anda ubah dipertahankan.")) return;
                  const r = await jalan(() => api<{ disusun: number; tanpa_teknisi: number; melebihi: number }>(`/api/jadwal-teknisi/susun`, "POST", { bulan }), (x) => `${x.disusun} kunjungan disusun${x.tanpa_teknisi ? ` · ${x.tanpa_teknisi} belum ada teknisi` : ""}${x.melebihi ? ` · ${x.melebihi} melebihi hari kerja` : ""}`);
                  if (r) await muat(bulan); }} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{data.baris.length ? "Susun ulang draft" : "Susun draft"}</button>
                <button type="button" disabled={sibuk || !data.baris.length || tanpaTeknisi > 0} title={tanpaTeknisi ? "Tetapkan teknisi untuk semua kunjungan dulu" : undefined}
                  onClick={async () => { if (!confirm(`Terbitkan jadwal ${lblBulan(bulan)}? Jadwal dikirim ke WA tiap teknisi (bila saklar WA aktif).`)) return;
                    const r = await jalan(() => api<{ kirim: { teknisi: string; kunjungan: number; terkirim: boolean; alasan?: string }[] }>(`/api/jadwal-teknisi/terbit`, "POST", { bulan }),
                      (x) => `Terbit. WA: ${x.kirim.map((k) => `${k.teknisi} ${k.terkirim ? "terkirim" : `tidak (${k.alasan ?? "gagal"})`}`).join(" · ") || "—"}`);
                    if (r) await muat(bulan); }} className="rounded-md border border-emerald-600 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">Terbitkan</button>
              </>}
            </CardContent>
          </Card>

          {!data.kalender_libur_ada && <p className="text-xs text-amber-700 dark:text-amber-400">Kalender libur tahun {bulan.slice(0, 4)} belum diisi (menu Holidays) — hari libur nasional belum dilewati.</p>}
          {prev && (
            <Card><CardContent className="space-y-1 py-3 text-sm">
              <div><b>Pratinjau {lblBulan(bulan)}:</b> {prev.jatuh_tempo} dari {prev.populasi} faskes KSO jatuh tempo, {prev.hari_kerja} hari kerja{prev.melebihi ? ` · ${prev.melebihi} melebihi hari kerja` : ""}.</div>
              <div className="text-muted-foreground text-xs">Per teknisi: {prev.per_teknisi.map((t) => `${t.teknisi} ${t.kunjungan} faskes/${t.hari} hari`).join(" · ") || "—"}</div>
              <div className="text-muted-foreground text-xs">Per wilayah: {prev.per_wilayah.map((w) => `${w.wilayah} ${w.faskes}`).join(" · ")}</div>
            </CardContent></Card>
          )}
          {perTek.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {perTek.map((t) => (
                <div key={t.nama} className={cn("bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]", t.nama.startsWith("(") && "border-amber-500")}>
                  <div className="text-muted-foreground truncate text-xs">{t.nama}</div>
                  <div className="text-xl font-bold tabular-nums">{t.n}</div>
                  <div className="text-muted-foreground text-xs">{t.hari.size} hari</div>
                </div>
              ))}
            </div>
          )}
          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-muted-foreground text-xs">
                Faskes dengan alat KSO operasional, jatuh tempo menurut frekuensinya (default: ada alat per tes → tiap 2 bulan, beli reagen → tiap 3 bulan). Satu wilayah = satu trip, maksimal 3 faskes per hari.
                {data.status === "terbit" ? ` Terbit ${data.terbit_at ? new Date(data.terbit_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : ""}${data.terbit_oleh ? ` oleh ${data.terbit_oleh}` : ""} — perubahan sesudah terbit tidak dikirim ulang otomatis; teknisi bisa cek lewat #JADWAL.` : " Draft bisa diedit; terbitkan sebelum tanggal 1."}
              </p>
              <DataTable columns={kolom} data={baris} getKey={(b) => b.id} searchPlaceholder="Cari faskes…" pageSize={50}
                empty={data.baris.length ? "Tidak ada baris dengan filter ini." : "Belum ada jadwal bulan ini — tekan Susun draft."}
                toolbar={<>
                  <FilterSelect label="Teknisi" value={fTeknisi} onChange={setFTeknisi} options={[...opsiTek, { value: "__kosong", label: "(belum ada teknisi)" }]} />
                  <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={[{ value: "rencana", label: "Rencana" }, { value: "selesai", label: "Selesai" }, { value: "batal", label: "Batal" }]} />
                </>} />
            </CardContent>
          </Card>
        </>
      )}

      {tab === "wilayah" && wil && (
        <Card><CardContent className="space-y-2 pt-6">
          <p className="text-muted-foreground text-xs">Wilayah = area faskes. Tiap wilayah dipegang satu teknisi; faskes di wilayah tanpa teknisi tetap disusun tapi jadwal belum bisa diterbitkan sebelum teknisinya ditetapkan.</p>
          <DataTable columns={kolomWil} data={wil.wilayah} getKey={(w) => w.wilayah} pageSize={50} searchPlaceholder="Cari wilayah…" empty="Tidak ada wilayah." />
        </CardContent></Card>
      )}
      {tab === "frekuensi" && frek && (
        <Card><CardContent className="space-y-2 pt-6">
          <p className="text-muted-foreground text-xs">Seberapa sering tiap faskes dikunjungi rutin. Kosongkan untuk memakai default (alat per tes → tiap 2 bulan, beli reagen → tiap 3 bulan). Berlaku untuk penyusunan berikutnya.</p>
          <DataTable columns={kolomFrek} data={frek} getKey={(f) => f.account_id} pageSize={50} searchPlaceholder="Cari faskes…" empty="Tidak ada faskes KSO." />
        </CardContent></Card>
      )}
    </div>
  );
}
