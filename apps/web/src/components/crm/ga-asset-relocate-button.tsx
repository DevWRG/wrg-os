"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinned } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { isoWib } from "@/lib/tanggal-wib";
import { UserOrNamePicker, type AppUserOption } from "./ga-asset-pic-actions";

const MAKS_BYTE = 10 * 1024 * 1024;

// Relokasi aset GA (13 Okt 2026): pindah lokasi + berita acara bertanda tangan
// WAJIB, disimpan satu langkah. PIC boleh tetap (default) atau ikut diganti.
export function RelocateAssetButton({
  assetId,
  assetCode,
  currentLocation,
  users,
}: {
  assetId: string;
  assetCode: string;
  currentLocation: string | null;
  users: AppUserOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toLocation, setToLocation] = useState("");
  const [keepPic, setKeepPic] = useState(true);
  const [userId, setUserId] = useState("");
  const [picName, setPicName] = useState("");
  const [tanggal, setTanggal] = useState(isoWib());
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);

  function reset() {
    setToLocation(""); setKeepPic(true); setUserId(""); setPicName("");
    setTanggal(isoWib()); setReason(""); setFile(null); setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Unggah berita acara yang sudah ditandatangani.");
    if (file.size > MAKS_BYTE) return setError("File berita acara maksimal 10MB.");
    if (!keepPic && !userId && !picName.trim()) return setError("Pilih PIC baru, atau centang PIC tetap.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("to_location", toLocation.trim());
      fd.set("keep_pic", keepPic ? "true" : "false");
      if (!keepPic && userId) fd.set("to_user_id", userId);
      if (!keepPic && !userId && picName.trim()) fd.set("to_pic_name", picName.trim());
      if (tanggal) fd.set("relocation_date", tanggal);
      if (reason.trim()) fd.set("reason", reason.trim());
      fd.set("file", file);
      const res = await fetch(`/api/ga-assets/${assetId}/relocate`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal relokasi");
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Relokasi (pindah lokasi + berita acara)" />}>
        <MapPinned />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Relokasi aset {assetCode}</DialogTitle>
          <DialogDescription>
            Lokasi sekarang: <span className="text-foreground font-medium">{currentLocation || "—"}</span>. Wajib unggah berita acara yang sudah ditandatangani.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`rl-loc-${assetId}`}>Lokasi Tujuan *</Label>
              <Input id={`rl-loc-${assetId}`} required value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="mis. Kantor Cabang Malang" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={keepPic} onCheckedChange={(v) => setKeepPic(Boolean(v))} />
              PIC tetap (tidak ganti pemegang)
            </label>
            {!keepPic && (
              <UserOrNamePicker users={users} userId={userId} setUserId={setUserId} picName={picName} setPicName={setPicName} label="PIC Baru" />
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={`rl-tgl-${assetId}`}>Tanggal Relokasi</Label>
              <Input id={`rl-tgl-${assetId}`} type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`rl-reason-${assetId}`}>Alasan</Label>
              <Textarea id={`rl-reason-${assetId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`rl-ba-${assetId}`}>Berita Acara (sudah ditandatangani) *</Label>
              <Input
                id={`rl-ba-${assetId}`}
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-muted-foreground text-xs">PDF/JPG/PNG/WEBP, maksimal 10MB.</p>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !toLocation.trim() || !file}>{busy ? "Menyimpan…" : "Simpan Relokasi"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
