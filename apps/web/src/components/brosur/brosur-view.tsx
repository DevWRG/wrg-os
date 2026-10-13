"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Copy, ExternalLink, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { KATEGORI, kirim, type JenisMateri, type Materi } from "./types";

const selCls = "h-9 w-full rounded-md border border-border bg-card px-2 text-sm";
const MAKS = 20 * 1024 * 1024;

function DialogMateri({ open, onClose, awal, brands, driveSiap }: {
  open: boolean; onClose: () => void; awal: Materi | null; brands: string[]; driveSiap: boolean;
}) {
  const router = useRouter();
  const [jenis, setJenis] = useState<JenisMateri>(awal?.jenis ?? "brosur");
  const [judul, setJudul] = useState(awal?.judul ?? "");
  const [brand, setBrand] = useState(awal?.brand ?? "");
  const [produk, setProduk] = useState(awal?.produk ?? "");
  const [kategori, setKategori] = useState(awal?.kategori ?? "");
  const [url, setUrl] = useState(awal?.jenis === "video" ? awal.url : "");
  const [catatan, setCatatan] = useState(awal?.catatan ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const butuhFile = jenis === "brosur" && !awal;
  async function simpan() {
    setErr(null);
    if (file && file.size > MAKS) return setErr("Berkas brosur maksimal 20 MB.");
    const fd = new FormData();
    if (!awal) fd.set("jenis", jenis);
    fd.set("judul", judul); fd.set("brand", brand); fd.set("produk", produk); fd.set("kategori", kategori); fd.set("catatan", catatan);
    if (jenis === "video") fd.set("url", url);
    if (jenis === "brosur" && file) fd.set("file", file);
    setBusy(true);
    try {
      await kirim(awal ? `/api/brosur/${awal.id}` : "/api/brosur", { method: awal ? "PATCH" : "POST", body: fd });
      router.refresh();
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{awal ? `Ubah ${awal.kode}` : "Tambah brosur / video"}</DialogTitle>
          <DialogDescription>
            Brosur diunggah ke Google Drive dan otomatis dibuka untuk “siapa pun dengan tautan” — tautannya bisa langsung diteruskan AM ke customer.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {!awal && (
            <div className="flex gap-2">
              {(["brosur", "video"] as const).map((j) => (
                <Button key={j} type="button" size="sm" variant={jenis === j ? "default" : "outline"} onClick={() => setJenis(j)}>
                  {j === "brosur" ? "Brosur (unggah file)" : "Video (tautan)"}
                </Button>
              ))}
            </div>
          )}
          <div className="space-y-1"><Label htmlFor="mp-judul">Judul *</Label>
            <Input id="mp-judul" value={judul} onChange={(e) => setJudul(e.target.value)} placeholder="mis. Zybio Z3 — Brosur Hematology Analyzer" /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="mp-brand">Brand</Label>
              <Input id="mp-brand" list="mp-brand-opsi" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="mis. ZYBIO" />
              <datalist id="mp-brand-opsi">{brands.map((b) => <option key={b} value={b} />)}</datalist></div>
            <div className="space-y-1"><Label htmlFor="mp-produk">Produk</Label>
              <Input id="mp-produk" value={produk} onChange={(e) => setProduk(e.target.value)} placeholder="mis. Z3" /></div>
            <div className="space-y-1"><Label htmlFor="mp-kat">Kategori</Label>
              <select id="mp-kat" className={selCls} value={kategori} onChange={(e) => setKategori(e.target.value)}>
                <option value="">—</option>{KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
              </select></div>
          </div>
          {jenis === "brosur" ? (
            <div className="space-y-1"><Label htmlFor="mp-file">{awal ? "Ganti berkas (opsional)" : "Berkas brosur *"}</Label>
              <Input id="mp-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-muted-foreground text-xs">
                PDF/JPG/PNG/WEBP, maksimal 20 MB.{awal ? " Berkas baru jadi versi terbit; berkas lama tetap tersimpan di Drive sebagai arsip." : ""}
              </p>
              {!driveSiap && <p className="text-destructive text-xs">Google Drive belum dikonfigurasi di server — unggah belum bisa.</p>}
            </div>
          ) : (
            <div className="space-y-1"><Label htmlFor="mp-url">Tautan video *</Label>
              <Input id="mp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/… atau tautan Google Drive" /></div>
          )}
          <div className="space-y-1"><Label htmlFor="mp-cat">Catatan</Label>
            <Textarea id="mp-cat" rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="opsional — mis. versi 2026, untuk RS tipe C" /></div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={simpan} disabled={busy || !judul.trim() || (!brand.trim() && !produk.trim()) || (butuhFile && (!file || !driveSiap)) || (jenis === "video" && !url.trim())}>
            {busy ? (jenis === "brosur" && file ? "Mengunggah ke Drive…" : "Menyimpan…") : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// F130 — katalog brosur (file di Google Drive) & video training per produk.
export function BrosurView({ data, driveSiap, bolehTambah, bolehUbah }: { data: Materi[]; driveSiap: boolean; bolehTambah: boolean; bolehUbah: boolean }) {
  const router = useRouter();
  const [jenis, setJenis] = useState("");
  const [brand, setBrand] = useState("");
  const [nonaktif, setNonaktif] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; n: number; awal: Materi | null }>({ open: false, n: 0, awal: null });
  const [info, setInfo] = useState<string | null>(null);

  const brands = useMemo(() => [...new Set(data.map((m) => m.brand).filter((b): b is string => !!b))].sort(), [data]);
  const tampil = data.filter((m) => (nonaktif || m.aktif) && (!jenis || m.jenis === jenis) && (!brand || m.brand === brand));

  async function patch(m: Materi, field: "aktif" | "cek_ulang", nilai: string) {
    const fd = new FormData();
    fd.set(field, nilai);
    try {
      await kirim(`/api/brosur/${m.id}`, { method: "PATCH", body: fd });
      router.refresh();
    } catch (e) { setInfo((e as Error).message); }
  }
  async function salin(m: Materi) {
    try { await navigator.clipboard.writeText(m.url); setInfo(`Tautan ${m.kode} disalin.`); }
    catch { setInfo("Gagal menyalin — buka tautannya lalu salin dari browser."); }
  }

  const kolom: DataColumn<Materi>[] = [
    { id: "judul", header: "Materi", sortable: true, accessor: (m) => m.judul, cell: (m) => (
      <div className="flex items-start gap-2">
        {m.jenis === "video" ? <Clapperboard className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden /> : <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />}
        <div>
          <a href={m.url} target="_blank" rel="noreferrer" className={cn("font-medium hover:underline", !m.aktif && "text-muted-foreground line-through")}>{m.judul}</a>
          <div className="text-muted-foreground text-xs">{[m.kode, m.jenis === "video" ? "video" : m.file_name, m.catatan].filter(Boolean).join(" · ")}</div>
        </div>
      </div>) },
    { id: "brand", header: "Brand / produk", sortable: true, accessor: (m) => `${m.brand ?? ""} ${m.produk ?? ""}`, cell: (m) => (
      <div><div className="text-sm">{m.brand ?? "—"}</div>{m.produk && <div className="text-muted-foreground text-xs">{m.produk}</div>}</div>) },
    { id: "kategori", header: "Kategori", sortable: true, accessor: (m) => m.kategori ?? "", cell: (m) => <span className="text-sm">{m.kategori ?? "—"}</span> },
    { id: "akses", header: "Akses", accessor: (m) => String(m.akses_publik), cell: (m) => m.akses_publik === false ? (
      <div className="space-y-1">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">belum publik</span>
        {bolehUbah && <div><button type="button" className="text-xs underline" onClick={() => void patch(m, "cek_ulang", "true")}>coba lagi</button></div>}
      </div>
    ) : m.akses_publik ? <span className="text-xs text-emerald-700 dark:text-emerald-400">siapa pun dgn tautan</span>
      : <span className="text-muted-foreground text-xs">belum dicek</span> },
    { id: "aksi", header: "", align: "right", cell: (m) => (
      <div className="flex justify-end gap-1 whitespace-nowrap">
        <Button size="sm" variant="ghost" onClick={() => void salin(m)} title="Salin tautan"><Copy className="size-4" /></Button>
        <Button size="sm" variant="ghost" render={<a href={m.url} target="_blank" rel="noreferrer" />} nativeButton={false} title="Buka"><ExternalLink className="size-4" /></Button>
        {bolehUbah && <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, n: dialog.n + 1, awal: m })}>Ubah</Button>}
        {bolehUbah && <Button size="sm" variant="ghost" onClick={() => void patch(m, "aktif", m.aktif ? "false" : "true")}>{m.aktif ? "Nonaktifkan" : "Aktifkan"}</Button>}
      </div>) },
  ];

  return (
    <div className="space-y-4">
      {!driveSiap && bolehTambah && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Unggah brosur belum bisa: Google Drive belum dikonfigurasi di server. Tautan video tetap bisa ditambahkan.
        </p>
      )}
      {info && <p className="text-muted-foreground text-sm">{info}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">Buka atau salin tautan, lalu teruskan ke customer. Tautan brosur bisa dibuka tanpa akun Google.</p>
        {bolehTambah && <Button size="sm" onClick={() => setDialog({ open: true, n: dialog.n + 1, awal: null })}>Tambah brosur / video</Button>}
      </div>
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={kolom} data={tampil} getKey={(m) => m.id} searchPlaceholder="Cari judul / produk / brand…" pageSize={25}
            empty={data.length === 0 ? "Katalog masih kosong." : "Tidak ada materi yang cocok dengan filter."}
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <FilterSelect label="Jenis" value={jenis} onChange={setJenis} options={[{ value: "brosur", label: "Brosur" }, { value: "video", label: "Video" }]} />
                <FilterSelect label="Brand" value={brand} onChange={setBrand} options={brands.map((b) => ({ value: b, label: b }))} />
                {bolehUbah && (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nonaktif} onChange={(e) => setNonaktif(e.target.checked)} /> Tampilkan yang nonaktif</label>
                )}
              </div>
            } />
        </CardContent>
      </Card>
      <DialogMateri key={dialog.n} open={dialog.open} onClose={() => setDialog({ ...dialog, open: false })} awal={dialog.awal} brands={brands} driveSiap={driveSiap} />
    </div>
  );
}
