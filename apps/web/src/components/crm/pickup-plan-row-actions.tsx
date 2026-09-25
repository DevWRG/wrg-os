"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldQuestion, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Kontak {
  nama: string;
  jabatan: string | null;
  hp_wa: string | null;
  is_primary: boolean;
}
interface Temuan {
  customer_name: string;
  tanggal: string;
  tujuan: string;
  libur: string | null;
  akhir_pekan: boolean;
  kalender_ada: boolean;
  pic_utama: Kontak | null;
  pic_backup: Kontak[];
  bermasalah: boolean;
  catatan: string;
}

export function PickupPlanRowActions({
  id,
  customerName,
  status,
}: {
  id: string;
  customerName: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // null = belum pernah fetch. setState HANYA di dalam .then/await, bukan
  // sinkron di body effect — hindari lint react-hooks/set-state-in-effect
  // (pelajaran dari HistoryDialog F50).
  const [temuan, setTemuan] = useState<Temuan | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function cekSekarang() {
    setOpen(true);
    setTemuan(null);
    setError(null);
    try {
      const res = await fetch(`/api/pickup-plan/${id}/previsit`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal mengecek");
      setTemuan(data as Temuan);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  async function setStatus(next: "selesai" | "batal") {
    setBusy(true);
    try {
      const res = await fetch(`/api/pickup-plan/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("gagal");
      router.refresh();
    } catch {
      /* biarkan tombol aktif lagi supaya bisa dicoba ulang */
    } finally {
      setBusy(false);
    }
  }

  function hapus() {
    confirm(
      { title: "Hapus jadwal?", description: `Jadwal trip ke "${customerName}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/pickup-plan/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Button variant="ghost" size="icon-sm" aria-label="Cek sekarang" onClick={cekSekarang} title="Cek libur & PIC">
        <ShieldQuestion />
      </Button>
      {status === "rencana" && (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Tandai selesai" disabled={busy} onClick={() => setStatus("selesai")} title="Tandai selesai">
            <CheckCircle2 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Batalkan" disabled={busy} onClick={() => setStatus("batal")} title="Batalkan trip">
            <XCircle />
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Hapus" disabled={busy} onClick={hapus} className="text-danger hover:text-danger">
        <Trash2 />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cek sebelum jalan — {customerName}</DialogTitle>
          </DialogHeader>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : temuan === null ? (
            <p className="text-muted-foreground text-sm">Mengecek…</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                <span className="text-muted-foreground">Tanggal:</span> {temuan.tanggal} · {temuan.tujuan}
              </p>
              {temuan.libur && <p className="text-warning">⚠️ Hari libur: {temuan.libur} — kemungkinan tutup</p>}
              {temuan.akhir_pekan && <p className="text-warning">⚠️ Jatuh di akhir pekan</p>}
              {!temuan.kalender_ada && (
                <p className="text-warning">
                  ⚠️ Kalender libur {temuan.tanggal.slice(0, 4)} belum diisi di sistem — cek manual
                </p>
              )}
              {!temuan.libur && !temuan.akhir_pekan && temuan.kalender_ada && (
                <p className="text-success">✓ Hari kerja</p>
              )}
              <div>
                <p className="text-muted-foreground mb-1">PIC:</p>
                {temuan.pic_utama ? (
                  <ul className="ml-4 list-disc">
                    <li>
                      <span className="font-medium">{temuan.pic_utama.nama}</span>
                      {temuan.pic_utama.jabatan ? ` (${temuan.pic_utama.jabatan})` : ""}
                      {temuan.pic_utama.hp_wa ? ` — ${temuan.pic_utama.hp_wa}` : ""} <span className="text-muted-foreground">· utama</span>
                    </li>
                    {temuan.pic_backup.map((b, i) => (
                      <li key={i}>
                        {b.nama}
                        {b.jabatan ? ` (${b.jabatan})` : ""}
                        {b.hp_wa ? ` — ${b.hp_wa}` : ""} <span className="text-muted-foreground">· backup</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-warning">Belum ada di data — cari kontaknya dulu sebelum berangkat.</p>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Ketersediaan PIC tidak dicek sistem (data jam kerja/cuti PIC tidak ada) — yang dipastikan
                hanya hari libur. Tetap konfirmasi via telepon.
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
