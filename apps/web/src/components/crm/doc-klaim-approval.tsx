"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { alasanTolakBayar, alasanTolakPutus, type PemutusKlaim } from "@/lib/doc-klaim-access";
import type { DocKlaim } from "@/components/tables/doc-klaim-table";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

// Approval reimburse — HoD pengaju setujui/tolak, Finance tandai dibayar
// (keputusan user 15 Okt 2026). Tombol hanya untuk yang berwenang; selebihnya
// teks siapa yang ditunggu. Forward-only, cermin TRANSITIONS di
// apps/api/src/repo/doc-klaim.ts: baru -> disetujui|ditolak -> dibayar.
export function DocKlaimApproval({ klaim, pemutus }: { klaim: DocKlaim; pemutus: PemutusKlaim }) {
  const { id, status } = klaim;
  const router = useRouter();
  const [open, setOpen] = useState<"disetujui" | "ditolak" | null>(null);
  const [nominal, setNominal] = useState("");
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bayarError, setBayarError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function decide(decision: "disetujui" | "ditolak") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-klaim/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          nominal_disetujui: decision === "disetujui" && nominal.trim() ? Number(nominal) : undefined,
          catatan: catatan.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal simpan");
      setOpen(null);
      setNominal("");
      setCatatan("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function kirimBayar() {
    setBusy(true);
    setBayarError(null);
    try {
      const res = await fetch(`/api/doc-klaim/${id}/bayar`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal tandai dibayar");
      router.refresh();
    } catch (err) {
      setBayarError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  function bayar() {
    const nominal = klaim.nominal_disetujui != null ? `Rp${Math.round(klaim.nominal_disetujui).toLocaleString("id-ID")}` : klaim.nominal ?? "-";
    confirm(
      {
        title: "Tandai klaim dibayar?",
        description: `Reimburse ${nominal} ke ${klaim.employee_nama ?? klaim.sender_name ?? "pengaju"} dicatat sudah dibayar. Tidak bisa dibatalkan.`,
        confirmLabel: "Tandai dibayar",
      },
      () => void kirimBayar(),
    );
  }

  const tunggu = (t: string) => <span className="text-muted-foreground text-xs whitespace-nowrap">{t}</span>;

  if (status === "baru") {
    const alasan = alasanTolakPutus(klaim, pemutus);
    if (alasan) return tunggu(alasan);
    return (
      <div className="flex gap-1">
        <Dialog open={open === "disetujui"} onOpenChange={(o) => setOpen(o ? "disetujui" : null)}>
          <DialogTrigger render={<Button size="sm" disabled={busy} />}>
            <Check /> Setujui
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Setujui klaim</DialogTitle>
              <DialogDescription>Nominal opsional — kosongkan kalau sesuai nota (tak diubah).</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Nominal disetujui (opsional)</Label>
                <Input type="number" min={1} value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder={`Sesuai nota${klaim.nominal ? ` (${klaim.nominal})` : ""}`} />
                <p className="text-muted-foreground text-xs">Tidak boleh melebihi nominal nota. Wajib diisi kalau nominal nota tak terbaca.</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Catatan</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Opsional" />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button disabled={busy} onClick={() => decide("disetujui")}>{busy ? "Menyimpan…" : "Setujui"}</Button>
              <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={open === "ditolak"} onOpenChange={(o) => setOpen(o ? "ditolak" : null)}>
          <DialogTrigger render={<Button size="sm" variant="outline" disabled={busy} />}>
            <X /> Tolak
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Tolak klaim</DialogTitle>
              <DialogDescription>Isi alasan penolakan (opsional, tapi sebaiknya diisi).</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Alasan</Label>
                <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. nota tidak jelas / bukan kebutuhan kantor" />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
            </DialogBody>
            <DialogFooter>
              <Button variant="destructive" disabled={busy} onClick={() => decide("ditolak")}>{busy ? "Menyimpan…" : "Tolak"}</Button>
              <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (status === "disetujui") {
    const alasan = alasanTolakBayar(klaim, pemutus);
    if (alasan) return tunggu(alasan);
    return (
      <div className="flex flex-col items-end gap-0.5">
        {dialog}
        <Button size="sm" disabled={busy} onClick={bayar}>
          {busy ? "Menyimpan…" : "Tandai Dibayar"}
        </Button>
        {bayarError && <span className="text-destructive text-xs">{bayarError}</span>}
      </div>
    );
  }

  return null; // ditolak/dibayar — terminal, tak ada aksi lanjutan
}
