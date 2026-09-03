"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface AssetOption {
  id: string;
  asset_code: string;
  nama: string;
  is_critical: boolean;
}

export interface AppUserOption {
  id: string;
  name: string | null;
}

// Pelapor & PIC: dropdown akun `app_user` + jalur "di luar daftar" yang tetap
// teks bebas — meniru F139 GA Helpdesk UTUH (`reporter_user_id` +
// `reporter_name_override`), bukan cuma dropdown-nya.
//
// Kenapa jalur teks tak dibuang: migrasi 087 mencatat teks bebas di sini
// sebagai keputusan sadar — "pelapor/PIC belum tentu karyawan terdaftar HR"
// (mis. anak magang, vendor, satpam yang melapor PC mati). Kalau dropdown
// dijadikan satu-satunya jalan, tiket dari orang-orang itu jadi tak bisa
// dicatat sama sekali. Yang berubah: kalau orangnya PUNYA akun, sekarang
// tersimpan sebagai FK (migrasi 164) sehingga bisa disaring "punya saya",
// bukan dicocokkan lewat ejaan nama.
const LUAR = "__luar__"; // sentinel <option> untuk "di luar daftar"

export function AddItTicketButton({ assets, users = [] }: { assets: AssetOption[]; users?: AppUserOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ asset_id: assets[0]?.id ?? "", masalah: "", reported_by: "", assigned_to: "" });
  // "" = tak diisi · LUAR = di luar daftar (pakai kotak teks) · selain itu = id akun
  const [reporterSel, setReporterSel] = useState("");
  const [picSel, setPicSel] = useState("");
  const userLabel = (u: AppUserOption) => u.name?.trim() || u.id.slice(0, 8);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Salah satu jalur saja per orang: kalau akun dipilih, teksnya tak
        // dikirim (server pun mengabaikannya) supaya satu tiket tak menyimpan
        // dua versi nama.
        body: JSON.stringify({
          asset_id: f.asset_id,
          masalah: f.masalah.trim(),
          reported_by_user_id: reporterSel && reporterSel !== LUAR ? reporterSel : undefined,
          assigned_to_user_id: picSel && picSel !== LUAR ? picSel : undefined,
          reported_by: reporterSel === LUAR ? f.reported_by.trim() || undefined : undefined,
          assigned_to: picSel === LUAR ? f.assigned_to.trim() || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ asset_id: assets[0]?.id ?? "", masalah: "", reported_by: "", assigned_to: "" });
      setReporterSel("");
      setPicSel("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Buat Tiket
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Buat tiket masalah</DialogTitle>
          <DialogDescription>SLA otomatis: 2 jam untuk aset kritis, 24 jam untuk aset normal (hari kerja).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nt-asset">Aset</Label>
              <select
                id="nt-asset"
                className={selectCls}
                value={f.asset_id}
                onChange={(e) => setF((p) => ({ ...p, asset_id: e.target.value }))}
              >
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_code} — {a.nama}
                    {a.is_critical ? " (KRITIS)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-masalah">Masalah</Label>
              <Textarea id="nt-masalah" value={f.masalah} onChange={(e) => setF((p) => ({ ...p, masalah: e.target.value }))} placeholder="mis. tidak bisa nyala, mati mendadak, dst" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-lapor">Pelapor (opsional)</Label>
              <select
                id="nt-lapor"
                className={selectCls}
                value={reporterSel}
                onChange={(e) => setReporterSel(e.target.value)}
              >
                <option value="">— tak diisi —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
                <option value={LUAR}>di luar daftar (tulis nama)</option>
              </select>
              {reporterSel === LUAR && (
                <Input
                  aria-label="Nama pelapor di luar daftar"
                  value={f.reported_by}
                  onChange={(e) => setF((p) => ({ ...p, reported_by: e.target.value }))}
                  placeholder="nama pelapor — mis. vendor/magang tanpa akun"
                />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-pic">PIC (opsional)</Label>
              <select id="nt-pic" className={selectCls} value={picSel} onChange={(e) => setPicSel(e.target.value)}>
                <option value="">— tak diisi —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
                <option value={LUAR}>di luar daftar (tulis nama)</option>
              </select>
              {picSel === LUAR && (
                <Input
                  aria-label="Nama PIC di luar daftar"
                  value={f.assigned_to}
                  onChange={(e) => setF((p) => ({ ...p, assigned_to: e.target.value }))}
                  placeholder="nama PIC — mis. teknisi vendor"
                />
              )}
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
