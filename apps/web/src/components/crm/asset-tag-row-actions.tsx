"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, ClipboardCheck, History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Asset {
  id: string;
  kode: string;
  nama: string;
  jenis_kepemilikan: string;
  kategori: string | null;
  lokasi_cabang: string | null;
  letak: string | null;
  active: boolean;
}

function EditDialog({ asset }: { asset: Asset }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: asset.nama,
    jenis_kepemilikan: asset.jenis_kepemilikan,
    kategori: asset.kategori ?? "",
    lokasi_cabang: asset.lokasi_cabang ?? "",
    letak: asset.letak ?? "",
    active: asset.active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset-tags/${asset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          jenis_kepemilikan: f.jenis_kepemilikan,
          kategori: f.kategori.trim() || undefined,
          lokasi_cabang: f.lokasi_cabang.trim() || undefined,
          letak: f.letak.trim() || undefined,
          active: f.active,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Edit" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit — {asset.kode}</DialogTitle>
          <DialogDescription>Update nama, jenis, kategori, lokasi, aktif/nonaktif.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="at-nama">Nama</Label>
              <Input id="at-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="at-jenis">Jenis Kepemilikan</Label>
              <select id="at-jenis" className={selectCls} value={f.jenis_kepemilikan} onChange={(e) => setF((p) => ({ ...p, jenis_kepemilikan: e.target.value }))}>
                <option value="aset">Aset</option>
                <option value="inventaris">Inventaris</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="at-kategori">Kategori</Label>
              <Input id="at-kategori" value={f.kategori} onChange={(e) => setF((p) => ({ ...p, kategori: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="at-lokasi">Lokasi Cabang</Label>
              <Input id="at-lokasi" value={f.lokasi_cabang} onChange={(e) => setF((p) => ({ ...p, lokasi_cabang: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="at-letak">Letak</Label>
              <Input id="at-letak" value={f.letak} onChange={(e) => setF((p) => ({ ...p, letak: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.active} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, active: v }))} />
              <Label>Aktif</Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AuditDialog({ asset }: { asset: Asset }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ audited_by: "", found: true, note: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset-tags/${asset.id}/audit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audited_by: f.audited_by.trim(), found: f.found, note: f.note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ audited_by: "", found: true, note: "" });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Catat audit" />}>
        <ClipboardCheck />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Catat audit — {asset.kode}</DialogTitle>
          <DialogDescription>Verifikasi fisik: label & barangnya masih ada di lokasi?</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="au-by">Diaudit oleh</Label>
              <Input id="au-by" value={f.audited_by} onChange={(e) => setF((p) => ({ ...p, audited_by: e.target.value }))} required />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.found} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, found: v }))} />
              <Label>{f.found ? "Ditemukan" : "Tidak ditemukan / hilang"}</Label>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="au-note">Catatan</Label>
              <Textarea id="au-note" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface AuditLogRow {
  id: string;
  audited_by: string;
  audited_at: string;
  found: boolean;
  note: string | null;
}

function HistoryDialog({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch(`/api/asset-tags/${asset.id}/audit`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLogs(d?.logs ?? []));
  }, [open, asset.id]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Riwayat audit" />}>
        <History />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Riwayat audit — {asset.kode}</DialogTitle>
          <DialogDescription>50 entri terakhir.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {logs === null ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada riwayat audit.</p>
          ) : (
            <div className="max-h-96 overflow-x-auto overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-2 pr-4 whitespace-nowrap">Tanggal</th>
                    <th className="py-2 pr-4 whitespace-nowrap">Oleh</th>
                    <th className="py-2 pr-4 whitespace-nowrap">Hasil</th>
                    <th className="py-2">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5 pr-4 whitespace-nowrap">{new Date(l.audited_at).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{l.audited_by}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap">{l.found ? "Ditemukan" : "Tidak ditemukan"}</td>
                      <td className="py-1.5">{l.note ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssetTagRowActions({ asset }: { asset: Asset }) {
  return (
    <div className="flex justify-end gap-1.5">
      <AuditDialog asset={asset} />
      <HistoryDialog asset={asset} />
      <EditDialog asset={asset} />
    </div>
  );
}
