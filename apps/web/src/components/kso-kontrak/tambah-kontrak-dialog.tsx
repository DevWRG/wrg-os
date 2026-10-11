"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { kirim, type AkunKso } from "./types";

// Tambah kontrak manual. `akunAwal` dipakai dari layar Kelengkapan Data
// ("Buat kontrak" pada akun yang alatnya belum berkontrak) — alat yang belum
// berkontrak langsung tercentang. Pemanggil me-remount dialog ini (key) tiap
// kali dibuka, jadi state awal selalu bersih tanpa efek "reset".
export function TambahKontrakDialog({ open, akunAwal, onClose }: { open: boolean; akunAwal?: string | null; onClose: () => void }) {
  const router = useRouter();
  const [akunList, setAkunList] = useState<AkunKso[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [akun, setAkun] = useState(akunAwal ?? "");
  // null = belum disentuh pengguna → pakai default (alat akun yang belum berkontrak).
  const [alatPilih, setAlatPilih] = useState<Set<string> | null>(null);
  const [f, setF] = useState({ nomor: "", mulai: "", berakhir: "", nkt: "", pic_nama: "", catatan: "", auto_renew: false, nego: false });

  useEffect(() => {
    if (!open || akunList) return;
    kirim<{ akun: AkunKso[] }>("/api/kso-kontrak/akun").then((d) => setAkunList(d.akun)).catch((e) => setErr((e as Error).message));
  }, [open, akunList]);

  const pilihAkun = (id: string) => { setAkun(id); setAlatPilih(null); };
  const setAlat = (s: Set<string>) => setAlatPilih(s);

  const opsi = useMemo(() => (akunList ?? []).map((a) => ({ value: a.id, label: `${a.nama} (${a.alat.length} alat)` })), [akunList]);
  const terpilih = akunList?.find((a) => a.id === akun);
  const alat = alatPilih ?? new Set((terpilih?.alat ?? []).filter((x) => !x.berkontrak).map((x) => x.id));

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      await kirim("/api/kso-kontrak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nomor: f.nomor, account_id: akun, mulai: f.mulai || null, berakhir: f.berakhir || null,
          nkt: f.nkt === "" ? null : Number(f.nkt), pic_nama: f.pic_nama, catatan: f.catatan,
          auto_renew: f.auto_renew, status: f.nego ? "NEGO" : "AKTIF", alat_ids: [...alat],
        }),
      });
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah kontrak KSO</DialogTitle>
          <DialogDescription>Satu kontrak = satu MoU untuk satu faskes. Kontrak yang dibuat di sini dianggap sudah diverifikasi.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          {err && <p className="text-destructive text-sm sm:col-span-2">{err}</p>}
          <div className="space-y-1 sm:col-span-2">
            <Label>Faskes</Label>
            <Combobox value={akun} onChange={(v) => pilihAkun(v)} options={opsi} placeholder={akunList ? "Pilih faskes ber-alat KSO…" : "Memuat…"} searchPlaceholder="Cari faskes…" disabled={!akunList} />
          </div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tk-nomor">Nomor MoU</Label>
            <Input id="tk-nomor" value={f.nomor} onChange={(e) => setF({ ...f, nomor: e.target.value })} placeholder="mis. 025 / WRG.PN-SPK / VIII / 2026" /></div>
          <div className="space-y-1"><Label htmlFor="tk-mulai">Mulai</Label>
            <Input id="tk-mulai" type="date" value={f.mulai} onChange={(e) => setF({ ...f, mulai: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tk-akhir">Berakhir</Label>
            <Input id="tk-akhir" type="date" value={f.berakhir} onChange={(e) => setF({ ...f, berakhir: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tk-nkt">NKT — nilai kontrak tahunan (Rp)</Label>
            <Input id="tk-nkt" type="number" min={0} value={f.nkt} onChange={(e) => setF({ ...f, nkt: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="tk-pic">PIC kontrak</Label>
            <Input id="tk-pic" value={f.pic_nama} onChange={(e) => setF({ ...f, pic_nama: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.auto_renew} onCheckedChange={(v) => setF({ ...f, auto_renew: v })} />Perpanjang otomatis</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.nego} onCheckedChange={(v) => setF({ ...f, nego: v })} />Masih negosiasi (MoU belum ditandatangani)</label>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tk-cat">Catatan</Label>
            <Textarea id="tk-cat" rows={2} value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} /></div>
          {terpilih && (
            <div className="space-y-1 sm:col-span-2">
              <Label>Alat yang dicakup ({alat.size} dari {terpilih.alat.length})</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {terpilih.alat.map((a) => (
                  <label key={a.id} className="flex items-start gap-2">
                    <Checkbox className="mt-0.5" checked={alat.has(a.id)}
                      onCheckedChange={(v) => { const s = new Set(alat); if (v) s.add(a.id); else s.delete(a.id); setAlat(s); }} />
                    <span>
                      {a.nama_alat ?? "Alat"} <span className="text-muted-foreground">· SN {a.sn ?? "—"}</span>
                      {a.berkontrak && <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">sudah ada di kontrak lain</span>}
                      {a.nomor_sheet && <span className="text-muted-foreground block text-xs">di sheet: {a.nomor_sheet}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="button" disabled={busy || !akun || !f.nomor.trim()} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan kontrak"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
