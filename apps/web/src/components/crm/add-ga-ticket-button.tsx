"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export interface AppUserOption { id: string; name: string | null }
export interface CategoryOption { id: string; code: string; nama: string; icon: string | null; default_priority: string }
// Aset GA (opsional). Sejak migrasi 306 Helpdesk menyerap Tiket IT (F52): kerusakan
// laptop/PC dilaporkan di sini dengan menunjuk asetnya. Aset kritis → prioritas
// critical & SLA 2 jam hari kerja (dihitung server).
export interface AssetOption { id: string; asset_code: string; nama: string; is_critical: boolean }

const NONE = "__none__"; // sentinel Select — Base UI Select tak suka value kosong

export function AddGaTicketButton({
  categories, users, assets = [],
}: { categories: CategoryOption[]; users: AppUserOption[]; assets?: AssetOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [priority, setPriority] = useState(NONE);
  const [reporterUserId, setReporterUserId] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [location, setLocation] = useState("");
  const [assetId, setAssetId] = useState("");
  const asset = assets.find((a) => a.id === assetId);

  function pilihAset(v: string) {
    setAssetId(v);
    // Laporan aset → kategori Perangkat IT otomatis (masih bisa diganti).
    const it = categories.find((c) => c.code === "IT");
    if (v && it) setCategoryId(it.id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ga-tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category_id: categoryId,
          priority: priority === NONE ? undefined : priority,
          reporter_user_id: reporterUserId || undefined,
          reporter_name_override: reporterUserId ? undefined : reporterName.trim() || undefined,
          location: location.trim() || undefined,
          asset_id: assetId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setTitle(""); setDescription(""); setPriority(NONE); setReporterUserId(""); setReporterName(""); setLocation(""); setAssetId("");
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
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Buat Tiket
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Buat tiket kendala operasional</DialogTitle>
          <DialogDescription>SLA otomatis dihitung dari kategori (bisa dioverride prioritas).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gt-title">Judul</Label>
              <Input id="gt-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. AC ruang fakturis mati" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gt-desc">Deskripsi</Label>
              <Textarea id="gt-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="opsional, detail kendala" />
            </div>
            {assets.length > 0 && (
              <div className="grid gap-1.5">
                <Label>Aset yang bermasalah (opsional)</Label>
                <Select value={assetId || NONE} onValueChange={(v) => pilihAset(v === NONE ? "" : (v ?? ""))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Tidak terkait aset">{(v: string) => {
                      const a = assets.find((x) => x.id === v);
                      return a ? `${a.asset_code} — ${a.nama}` : "Tidak terkait aset";
                    }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— tidak terkait aset —</SelectItem>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.asset_code} — {a.nama}{a.is_critical ? " (kritis)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {asset?.is_critical
                    ? "Aset kritis: prioritas Critical, batas SLA 2 jam hari kerja."
                    : "Pilih kalau kendalanya pada barang tertentu, mis. laptop atau PC."}
                </p>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Kategori</Label>
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih kategori">{(v: string) => {
                    const c = categories.find((x) => x.id === v);
                    return c ? `${c.icon ? c.icon + " " : ""}${c.nama}` : "Pilih kategori";
                  }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.nama}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Prioritas (override, opsional)</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v ?? NONE)}>
                <SelectTrigger>
                  <SelectValue placeholder="Ikut default kategori">{(v: string) => (v === NONE ? "Ikut default kategori" : v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— ikut default kategori —</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reporter</Label>
              <Select value={reporterUserId || NONE} onValueChange={(v) => setReporterUserId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih user terdaftar">{(v: string) => (v === NONE ? "Pilih user terdaftar" : users.find((u) => u.id === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— tidak pilih —</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Atau kalau belum terdaftar, isi nama bebas:</p>
              <Input value={reporterName} onChange={(e) => setReporterName(e.target.value)} placeholder="Nama bebas" disabled={!!reporterUserId} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gt-location">Lokasi</Label>
              <Input id="gt-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="opsional, mis. Ruang Fakturis" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !title.trim() || !categoryId || (!reporterUserId && !reporterName.trim())}>
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
