"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";

import { UndianSpinner, type KuponPeserta } from "./undian-spinner";

// F173 Pameran — kelola acara + QR form publik, daftar & export pengunjung, kocok pemenang
// undian doorprize, dan "jadikan deal" manual. Tombol hanya tampil bila aksinya boleh;
// gerbang sebenarnya di BFF.

type Divisi = "medical_hd" | "ivd";
const LABEL_DIVISI: Record<Divisi, string> = { medical_hd: "Medical & Hemodialisa", ivd: "IVD" };

interface Acara {
  id: number; slug: string; nama: string; divisi: Divisi; lokasi: string | null; tanggal_mulai: string; tanggal_selesai: string;
  prefix_kupon: string; buka: boolean; jatah_ip: number; menerima: boolean; jumlah_pengunjung: number; jumlah_pemenang: number;
}
interface Pengunjung {
  id: number; nama: string; institusi: string; kab_kota: string | null; provinsi: string | null; no_hp: string; kode_kupon: string; daftar_at: string;
  deal_id: string | null; hadiah: string | null; status_undian: string | null;
}
interface DaftarPengunjung { items: Pengunjung[]; count: number; total_rows: number; limit: number; offset: number }
interface Pemenang { id: number; hadiah: string; status: string; diundi_oleh: string; diundi_at: string; nama: string; institusi: string; no_hp: string; kode_kupon: string }

async function kirim<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((data as { error?: string }).error ?? `gagal (HTTP ${res.status})`));
  return data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const tgl = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const jam = (t: string) => new Date(t).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export interface Izin { buat: boolean; ubah: boolean; hapus: boolean }

export function PameranView({ izin }: { izin: Izin }) {
  const [acara, setAcara] = useState<Acara[] | null>(null);
  const [pilih, setPilih] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Acara | "baru" | null>(null);

  const muat = useCallback(() => {
    kirim<{ items: Acara[] }>("/api/pameran").then((d) => {
      setAcara(d.items);
      setErr(null);
      setPilih((p) => (p && d.items.some((a) => a.id === p) ? p : d.items[0]?.id ?? null));
    }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { muat(); }, [muat]);

  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!acara) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  const aktif = acara.find((a) => a.id === pilih) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {acara.length > 0 && (
          <div className="w-full sm:w-96">
            <Combobox value={pilih ? String(pilih) : ""} onChange={(v) => setPilih(Number(v))}
              options={acara.map((a) => ({ value: String(a.id), label: `${a.nama} · ${tgl(a.tanggal_mulai)}` }))} />
          </div>
        )}
        {izin.buat && <Button className="ml-auto" onClick={() => setForm("baru")}>Buat pameran</Button>}
      </div>
      {!aktif ? (
        <EmptyState title="Belum ada pameran" description="Buat pameran dulu — sistem akan membuatkan QR form registrasi untuk dipajang di booth." />
      ) : (
        <>
          <KartuAcara a={aktif} izin={izin} onUbah={() => setForm(aktif)} onBerubah={muat} />
          <Tabs defaultValue="pengunjung" className="gap-4">
            <TabsList>
              <TabsTrigger value="pengunjung">Pengunjung ({aktif.jumlah_pengunjung})</TabsTrigger>
              <TabsTrigger value="undian">Undian ({aktif.jumlah_pemenang})</TabsTrigger>
            </TabsList>
            <TabsContent value="pengunjung"><TabPengunjung key={aktif.id} a={aktif} izin={izin} onBerubah={muat} /></TabsContent>
            <TabsContent value="undian"><TabUndian key={aktif.id} a={aktif} izin={izin} onBerubah={muat} /></TabsContent>
          </Tabs>
        </>
      )}
      {form && <FormAcara awal={form === "baru" ? null : form} onClose={() => setForm(null)} onTersimpan={(id) => { setForm(null); setPilih(id); muat(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- kartu acara + QR

function KartuAcara({ a, izin, onUbah, onBerubah }: { a: Acara; izin: Izin; onUbah: () => void; onBerubah: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [salin, setSalin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/daftar/${a.slug}`;
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [url]);

  const saklar = async () => {
    try { await kirim(`/api/pameran/${a.id}`, json("PATCH", { buka: !a.buka })); onBerubah(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="bg-card flex flex-col gap-4 rounded-lg border p-4 sm:flex-row">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{a.nama}</h2>
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium",
            a.menerima ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-slate-500/15 text-slate-700 dark:text-slate-300")}>
            {a.menerima ? "Form menerima pendaftaran" : a.buka ? "Di luar tanggal pameran" : "Form ditutup"}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          {LABEL_DIVISI[a.divisi]} · {a.lokasi ? `${a.lokasi} · ` : ""}{tgl(a.tanggal_mulai)}{a.tanggal_selesai !== a.tanggal_mulai ? ` – ${tgl(a.tanggal_selesai)}` : ""} · kupon {a.prefix_kupon}-xxxxx
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="bg-background rounded border px-2 py-1 text-xs break-all">{url}</code>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url).then(() => { setSalin(true); setTimeout(() => setSalin(false), 1500); }); }}>
            {salin ? "Tersalin" : "Salin tautan"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open(url, "_blank", "noopener")}>Buka form</Button>
          <Button size="sm" onClick={() => window.open(`/layar/pameran/${a.id}`, "_blank", "noopener")}>Tampilkan di layar</Button>
        </div>
        {izin.ubah && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onUbah}>Ubah pameran</Button>
            <Button size="sm" variant={a.buka ? "outline" : "default"} onClick={saklar}>{a.buka ? "Tutup form" : "Buka form"}</Button>
          </div>
        )}
        {err && <p className="text-destructive text-sm">{err}</p>}
        <p className="text-muted-foreground text-xs">Form hanya menerima pendaftaran saat dibuka dan dalam rentang tanggal pameran (±1 hari). Satu no. HP = satu kupon. Jatah {a.jatah_ip.toLocaleString("id-ID")} pendaftaran per IP per 10 menit (Wi-Fi venue = satu IP untuk banyak orang).</p>
      </div>
      {qr && (
        <div className="flex shrink-0 flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR form registrasi ${a.nama}`} className="size-40 rounded border bg-white" />
          <a href={qr} download={`qr-${a.slug}.png`} className="text-primary text-xs underline">Unduh QR (PNG)</a>
        </div>
      )}
    </div>
  );
}

function FormAcara({ awal, onClose, onTersimpan }: { awal: Acara | null; onClose: () => void; onTersimpan: (id: number) => void }) {
  const [f, setF] = useState({
    nama: awal?.nama ?? "", divisi: (awal?.divisi ?? "medical_hd") as Divisi, lokasi: awal?.lokasi ?? "",
    tanggal_mulai: awal?.tanggal_mulai ?? "", tanggal_selesai: awal?.tanggal_selesai ?? "", slug: awal?.slug ?? "", prefix_kupon: awal?.prefix_kupon ?? "",
    jatah_ip: String(awal?.jatah_ip ?? 600),
  });
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const simpan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSibuk(true); setErr(null);
    const body = { ...f, slug: f.slug.trim() || undefined, prefix_kupon: f.prefix_kupon.trim() || undefined, tanggal_selesai: f.tanggal_selesai || f.tanggal_mulai };
    try {
      const r = awal ? await kirim<{ id: number }>(`/api/pameran/${awal.id}`, json("PATCH", body)) : await kirim<{ id: number }>("/api/pameran", json("POST", body));
      onTersimpan(r.id);
    } catch (e2) { setErr((e2 as Error).message); } finally { setSibuk(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{awal ? "Ubah pameran" : "Buat pameran"}</DialogTitle>
          <DialogDescription>QR form registrasi dibuat otomatis dari alamat form.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={simpan} className="space-y-3">
            <div className="space-y-1"><Label>Nama pameran</Label><Input value={f.nama} onChange={isi("nama")} required placeholder="PIT Pernefri 2026" /></div>
            <div className="space-y-1">
              <Label>Divisi</Label>
              <div className="flex gap-2">
                {(Object.keys(LABEL_DIVISI) as Divisi[]).map((d) => (
                  <Button key={d} type="button" size="sm" variant={f.divisi === d ? "default" : "outline"} onClick={() => setF({ ...f, divisi: d })}>{LABEL_DIVISI[d]}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1"><Label>Lokasi</Label><Input value={f.lokasi} onChange={isi("lokasi")} placeholder="Grand City Surabaya" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Tanggal mulai</Label><Input type="date" value={f.tanggal_mulai} onChange={isi("tanggal_mulai")} required /></div>
              <div className="space-y-1"><Label>Tanggal selesai</Label><Input type="date" value={f.tanggal_selesai} onChange={isi("tanggal_selesai")} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Alamat form (opsional)</Label><Input value={f.slug} onChange={isi("slug")} placeholder="otomatis dari nama" /></div>
              <div className="space-y-1"><Label>Awalan kupon (opsional)</Label><Input value={f.prefix_kupon} onChange={isi("prefix_kupon")} placeholder={f.divisi === "ivd" ? "IVD" : "MHD"} maxLength={5} /></div>
            </div>
            <div className="space-y-1">
              <Label>Jatah pendaftaran per IP / 10 menit</Label>
              <Input type="number" min={10} max={100000} value={f.jatah_ip} onChange={isi("jatah_ip")} />
              <p className="text-muted-foreground text-xs">Wi-Fi venue & operator seluler membuat banyak pengunjung tampil sebagai satu IP. Booth biasa: 600. Momen panggung (QR di layar besar): isi ± 2× jumlah penonton, mis. 4000 untuk 1.800 orang.</p>
            </div>
            {awal && <p className="text-xs text-amber-700 dark:text-amber-400">Mengubah alamat form membuat QR lama tidak berlaku lagi.</p>}
            {err && <p className="text-destructive text-sm">{err}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
              <Button type="submit" disabled={sibuk}>{sibuk ? "Menyimpan…" : "Simpan"}</Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- pengunjung

const HAL = 50;

function TabPengunjung({ a, izin, onBerubah }: { a: Acara; izin: Izin; onBerubah: () => void }) {
  const [d, setD] = useState<DaftarPengunjung | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const muat = useCallback(() => {
    const qs = new URLSearchParams({ limit: String(HAL), offset: String(offset) });
    if (q.trim()) qs.set("q", q.trim());
    kirim<DaftarPengunjung>(`/api/pameran/${a.id}/pengunjung?${qs}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [a.id, q, offset]);
  useEffect(() => { const t = setTimeout(muat, 250); return () => clearTimeout(t); }, [muat]);

  const aksi = async (fn: () => Promise<unknown>) => {
    try { await fn(); muat(); onBerubah(); } catch (e) { setErr((e as Error).message); }
  };
  const jadikanDeal = (p: Pengunjung) => confirm(
    { title: `Jadikan deal: ${p.institusi}?`, description: `Deal Prospecting baru (sumber pameran, kategori ${a.divisi === "ivd" ? "IVD" : "Medical"}) atas nama Anda. Kontak ${p.nama} dicatat di catatan deal.`, confirmLabel: "Jadikan deal" },
    () => aksi(() => kirim(`/api/pameran/pengunjung/${p.id}/deal`, json("POST", {}))),
  );
  const hapus = (p: Pengunjung) => confirm(
    { title: `Hapus ${p.nama}?`, description: `Kupon ${p.kode_kupon} ikut hangus. Pakai untuk entri iseng/ganda saja.`, confirmLabel: "Hapus", destructive: true },
    () => aksi(() => kirim(`/api/pameran/pengunjung/${p.id}`, { method: "DELETE" })),
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-full sm:w-72" placeholder="Cari nama, institusi, kota, kupon, no. HP…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <Button variant="outline" className="ml-auto" render={<a href={`/api/pameran/${a.id}/export?nama=${encodeURIComponent(a.slug)}`} download />}>
          Export CSV
        </Button>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : d.items.length === 0 ? (
        <EmptyState title={q ? "Tidak ada yang cocok" : "Belum ada pengunjung"} description={q ? "Coba kata kunci lain." : "Pajang QR di booth — pengunjung yang mengisi form akan muncul di sini."} />
      ) : (
        <>
          <div className="bg-card overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="p-2">Daftar</th><th className="p-2">Nama</th><th className="p-2">Institusi</th><th className="p-2">No. HP</th>
                <th className="p-2">Kupon</th><th className="p-2">Undian</th><th className="p-2">Deal</th>{(izin.ubah || izin.hapus) && <th className="p-2" />}
              </tr></thead>
              <tbody>
                {d.items.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-2 text-xs whitespace-nowrap">{jam(p.daftar_at)}</td>
                    <td className="p-2 font-medium">{p.nama}</td>
                    <td className="p-2">{p.institusi}{p.kab_kota && <div className="text-muted-foreground text-xs">{p.kab_kota}</div>}</td>
                    <td className="p-2 whitespace-nowrap tabular-nums">{p.no_hp}</td>
                    <td className="p-2 font-mono text-xs whitespace-nowrap">{p.kode_kupon}</td>
                    <td className="p-2 text-xs">{p.hadiah ? <span className={p.status_undian === "hangus" ? "line-through opacity-60" : "font-medium text-emerald-700 dark:text-emerald-400"}>{p.hadiah}</span> : "—"}</td>
                    <td className="p-2 text-xs">{p.deal_id ? (p.deal_id === "proses" ? "diproses…" : <a className="text-primary underline" href="/pipeline">Lihat deal</a>) : "—"}</td>
                    {(izin.ubah || izin.hapus) && (
                      <td className="p-2 text-right whitespace-nowrap">
                        {izin.ubah && !p.deal_id && <Button size="sm" variant="outline" onClick={() => jadikanDeal(p)}>Jadikan deal</Button>}
                        {izin.hapus && !p.deal_id && !p.hadiah && <Button size="sm" variant="ghost" className="text-destructive ml-1" onClick={() => hapus(p)}>Hapus</Button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>{d.offset + 1}–{d.offset + d.count} dari {d.total_rows} pengunjung</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={d.offset === 0} onClick={() => setOffset(Math.max(0, d.offset - HAL))}>Sebelumnya</Button>
              <Button size="sm" variant="outline" disabled={d.offset + d.count >= d.total_rows} onClick={() => setOffset(d.offset + HAL)}>Berikutnya</Button>
            </span>
          </div>
        </>
      )}
      {dialog}
    </section>
  );
}

// ---------------------------------------------------------------- undian

function TabUndian({ a, izin, onBerubah }: { a: Acara; izin: Izin; onBerubah: () => void }) {
  const [d, setD] = useState<{ items: Pemenang[]; sisa_peserta: number; sampel: KuponPeserta[] } | null>(null);
  const [hadiah, setHadiah] = useState("");
  const [jumlah, setJumlah] = useState("1");
  const [sibuk, setSibuk] = useState(false);
  const [baru, setBaru] = useState<{ hadiah: string; pemenang: { id: number; nama: string; institusi: string; kode_kupon: string }[] } | null>(null);
  const [spinner, setSpinner] = useState<(NonNullable<typeof baru> & { sampel: KuponPeserta[] }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const muat = useCallback(() => {
    kirim<{ items: Pemenang[]; sisa_peserta: number; sampel: KuponPeserta[] }>(`/api/pameran/${a.id}/undian`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, [a.id]);
  useEffect(() => { muat(); }, [muat]);

  const kocok = () => confirm(
    { title: `Kocok ${jumlah} pemenang "${hadiah}"?`, description: "Pemenang dipilih acak oleh sistem dan langsung tercatat, lalu layar spinner terbuka untuk ditampilkan ke penonton. Tidak bisa dikocok ulang — pemenang yang tidak hadir ditandai hangus lalu kocok lagi.", confirmLabel: "Kocok sekarang" },
    async () => {
      setSibuk(true); setErr(null);
      const sampel = d?.sampel ?? [];
      try {
        const r = await kirim<NonNullable<typeof baru>>(`/api/pameran/${a.id}/undian`, json("POST", { hadiah, jumlah: Number(jumlah) }));
        setSpinner({ ...r, sampel }); muat(); onBerubah();
      } catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
    },
  );
  const status = async (p: Pemenang, s: "menang" | "hangus") => {
    try { await kirim(`/api/pameran/undian/${p.id}`, json("PATCH", { status: s })); muat(); onBerubah(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="space-y-4">
      {izin.ubah && (
        <div className="bg-card flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="min-w-48 flex-1 space-y-1"><Label>Hadiah</Label><Input value={hadiah} onChange={(e) => setHadiah(e.target.value)} placeholder="Voucher belanja 500 rb" /></div>
          <div className="w-24 space-y-1"><Label>Jumlah</Label><Input type="number" min={1} max={50} value={jumlah} onChange={(e) => setJumlah(e.target.value)} /></div>
          <Button disabled={sibuk || !hadiah.trim() || !d?.sisa_peserta} onClick={kocok}>{sibuk ? "Mengocok…" : "Kocok pemenang"}</Button>
          <p className="text-muted-foreground w-full text-xs">{d ? `${d.sisa_peserta} peserta belum pernah menang ikut dikocok.` : ""}</p>
        </div>
      )}
      {baru && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Pemenang {baru.hadiah}</p>
          <ul className="mt-2 space-y-1">
            {baru.pemenang.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-2xl font-bold tracking-widest">{p.kode_kupon}</span>
                <span className="text-sm">{p.nama} — {p.institusi}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!d ? <p className="text-muted-foreground text-sm">Memuat…</p> : d.items.length === 0 ? (
        <EmptyState title="Belum ada pemenang" description="Isi nama hadiah lalu tekan Kocok pemenang. Setiap pengunjung hanya bisa menang sekali." />
      ) : (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-2">Diundi</th><th className="p-2">Hadiah</th><th className="p-2">Kupon</th><th className="p-2">Nama</th>
              <th className="p-2">Institusi</th><th className="p-2">No. HP</th><th className="p-2">Status</th>
            </tr></thead>
            <tbody>
              {d.items.map((p) => (
                <tr key={p.id} className={cn("border-b last:border-0", p.status === "hangus" && "opacity-60")}>
                  <td className="p-2 text-xs whitespace-nowrap">{jam(p.diundi_at)}<div className="text-muted-foreground">{p.diundi_oleh}</div></td>
                  <td className="p-2 font-medium">{p.hadiah}</td>
                  <td className="p-2 font-mono text-xs">{p.kode_kupon}</td>
                  <td className="p-2">{p.nama}</td>
                  <td className="p-2">{p.institusi}</td>
                  <td className="p-2 whitespace-nowrap tabular-nums">{p.no_hp}</td>
                  <td className="p-2 whitespace-nowrap">
                    <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", p.status === "menang" ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-slate-500/15 text-slate-700 dark:text-slate-300")}>
                      {p.status === "menang" ? "Menang" : "Hangus"}
                    </span>
                    {izin.ubah && (
                      <Button size="sm" variant="ghost" className="ml-1" onClick={() => status(p, p.status === "menang" ? "hangus" : "menang")}>
                        {p.status === "menang" ? "Tandai hangus" : "Pulihkan"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {spinner && (
        <UndianSpinner hadiah={spinner.hadiah} pemenang={spinner.pemenang} sampel={spinner.sampel}
          onTutup={() => { setBaru({ hadiah: spinner.hadiah, pemenang: spinner.pemenang }); setSpinner(null); }} />
      )}
      {dialog}
    </section>
  );
}
