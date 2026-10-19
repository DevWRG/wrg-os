"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, FileText, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ambil, MAKS_BYTES, ukuranTeks, type BuktiRow, type DaftarBukti } from "./types";

const PAGE_SIZE = 25;

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
};

// F32 Bukti Pembayaran — admin mengunggah foto bukti bayar + kode pengajuan; accounting
// merekonsiliasi sendiri (tanpa OCR/Accurate, keputusan Direktur 2026-10-19). Tipe & ukuran
// berkas divalidasi ulang di apps/api dari ISInya; di sini hanya pengecekan awal.
export function BuktiView({ awal, canUnggah }: { awal: DaftarBukti | null; canUnggah: boolean }) {
  const [data, setData] = useState<DaftarBukti>(awal ?? { total: 0, items: [] });
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const [errList, setErrList] = useState<string | null>(null);

  const [kode, setKode] = useState("");
  const [catatan, setCatatan] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const muat = useCallback(async (hal: number, cari: string) => {
    setPending(true);
    setErrList(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(hal * PAGE_SIZE) });
      if (cari.trim()) qs.set("q", cari.trim());
      setData(await ambil<DaftarBukti>(`/api/bukti-pembayaran?${qs}`));
      setPage(hal);
    } catch (e) {
      setErrList((e as Error).message);
    } finally {
      setPending(false);
    }
  }, []);

  // Batalkan pilihan sebelum disimpan. Nilai <input type=file> juga dikosongkan: tanpa itu
  // memilih ulang file yang SAMA tak memicu onChange, jadi foto yang baru dibuang tak bisa dipilih lagi.
  function hapusPilihan() {
    setFile(null);
    setErr(null);
    if (input.current) input.current.value = "";
  }

  async function unggah(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    if (!kode.trim()) { setErr("Kode pengajuan wajib diisi."); return; }
    if (!file) { setErr("Pilih foto bukti pembayaran."); return; }
    if (file.size > MAKS_BYTES) { setErr("File maksimal 8 MB."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      fd.set("kode", kode);
      fd.set("catatan", catatan);
      const baru = await ambil<BuktiRow>("/api/bukti-pembayaran", { method: "POST", body: fd });
      setOk(`Bukti untuk ${baru.kode_pengajuan} tersimpan.`);
      setKode("");
      setCatatan("");
      setFile(null);
      if (input.current) input.current.value = "";
      await muat(0, q);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<BuktiRow>[] = [
    { id: "kode", header: "Kode pengajuan", cell: (r) => <span className="font-mono font-medium">{r.kode_pengajuan}</span> },
    {
      id: "berkas", header: "Bukti",
      cell: (r) => (
        <a href={`/api/bukti-pembayaran/${r.id}/file`} target="_blank" rel="noopener noreferrer"
          className="text-primary inline-flex max-w-[16rem] items-center gap-1.5 hover:underline" title={r.nama}>
          <FileText className="size-4 shrink-0" /><span className="truncate">{r.nama}</span>
        </a>
      ),
    },
    { id: "ukuran", header: "Ukuran", align: "right", cell: (r) => <span className="tabular-nums whitespace-nowrap">{ukuranTeks(r.ukuran)}</span> },
    { id: "catatan", header: "Catatan", cell: (r) => <span className="text-muted-foreground">{r.catatan ?? "—"}</span> },
    { id: "oleh", header: "Diunggah oleh", cell: (r) => <span className="whitespace-nowrap">{r.oleh ?? "—"}</span> },
    { id: "at", header: "Waktu", cell: (r) => <span className="text-muted-foreground whitespace-nowrap">{tanggal(r.diunggah_at)}</span> },
  ];

  return (
    <div className="space-y-6">
      {canUnggah && (
        <Card>
          <CardHeader><CardTitle className="text-base font-semibold tracking-tight">Unggah bukti pembayaran</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={unggah} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="bp-kode">Kode pengajuan</Label>
                  <Input id="bp-kode" value={kode} onChange={(e) => setKode(e.target.value)} placeholder="mis. CN-00012" maxLength={40} autoComplete="off" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bp-catatan">Catatan (opsional)</Label>
                  <Input id="bp-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button type="button" variant="soft" onClick={() => input.current?.click()}>
                  <Upload className="size-4" /> Pilih foto
                </Button>
                <span className="text-muted-foreground text-sm">{file ? `${file.name} · ${ukuranTeks(file.size)}` : "Belum ada file"}</span>
                {file && (
                  <Button type="button" size="icon" variant="ghost" aria-label="Hapus foto yang dipilih" title="Hapus foto yang dipilih"
                    disabled={busy} onClick={hapusPilihan}>
                    <X className="size-4" />
                  </Button>
                )}
                <Button type="submit" disabled={busy} className="ml-auto">{busy ? "Mengunggah…" : "Simpan bukti"}</Button>
              </div>
              <p className="text-muted-foreground text-xs">JPG, PNG, WebP, atau PDF · maks. 8 MB · bukti tidak bisa diubah atau dihapus setelah disimpan.</p>
              {err && <p className="text-destructive text-sm" role="alert">{err}</p>}
              {ok && <p className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />{ok}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base font-semibold tracking-tight">Riwayat bukti ({data.total})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {errList && <p className="text-destructive text-sm" role="alert">{errList}</p>}
          <DataTable
            columns={columns}
            data={data.items}
            getKey={(r) => r.id}
            searchPlaceholder="Cari kode, nama berkas, catatan, pengunggah…"
            empty="Belum ada bukti pembayaran."
            server={{
              totalRows: data.total, page, pageSize: PAGE_SIZE, sort: null, q, pending,
              onPageChange: (p) => void muat(p, q),
              onPageSizeChange: () => {},
              onSortChange: () => {},
              onSearchChange: (v) => { setQ(v); void muat(0, v); },
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
