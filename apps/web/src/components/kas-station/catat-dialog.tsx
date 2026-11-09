"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TrxInput, barisKosong, nominalAngka, trxKosong, type BarisTrx } from "./trx-input";
import { hariIniWib, kasApi, rp, rpSelisih, tambahHari, tgl, type Harian } from "./types";

// F33 — catat kas satu hari. Tanggal boleh mundur (rapel) asal sesudah catatan pertama station
// dan sesudah minggu yang rekapnya sudah diajukan/disetujui (`batas`). Saldo awal = saldo akhir
// catatan tepat sebelum tanggal itu; hari sesudahnya dihitung ulang oleh API. Ringkasan "saldo awal
// + masuk − keluar = saldo akhir" dihitung langsung di layar. Aturan sebenarnya tetap di API.
export function CatatHarianDialog({ cabang, rows, batas, tanggalAwal, onClose, onSimpan, onBuka }: {
  cabang: string;
  /** Catatan station, urut tanggal turun (sama dengan API). */
  rows: Harian[];
  /** Akhir minggu terakhir yang diajukan/disetujui — tanggal ≤ ini terkunci. */
  batas: string | null;
  tanggalAwal?: string;
  onClose: () => void; onSimpan: () => void; onBuka: (id: string) => void;
}) {
  const pertama = rows.length === 0;
  const hariIni = hariIniWib();
  const tertua = rows.length ? rows[rows.length - 1].tanggal : null;
  const tglMin = [batas ? tambahHari(batas, 1) : null, tertua].filter((x): x is string => !!x).sort().pop();
  const [tanggal, setTanggal] = useState(tanggalAwal ?? hariIni);
  const sebelum = rows.find((r) => r.tanggal < tanggal) ?? null;
  const sudahAda = rows.find((r) => r.tanggal === tanggal) ?? null;
  const adaSesudah = rows.some((r) => r.tanggal > tanggal);
  const [saldoAwalInput, setSaldoAwalInput] = useState("");
  const [saldoFisik, setSaldoFisik] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [trx, setTrx] = useState<BarisTrx[]>([trxKosong()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ubah = (i: number, p: Partial<BarisTrx>) => setTrx((l) => l.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const terisi = trx.filter((b) => !barisKosong(b));
  const saldoAwal = pertama ? (saldoAwalInput === "" ? null : Number(saldoAwalInput)) : sebelum ? sebelum.saldo_akhir : null;
  const masuk = terisi.filter((b) => b.jenis === "masuk").reduce((a, b) => a + nominalAngka(b), 0);
  const keluar = terisi.filter((b) => b.jenis === "keluar").reduce((a, b) => a + nominalAngka(b), 0);
  const saldoAkhir = saldoAwal === null ? null : saldoAwal + masuk - keluar;
  const minus = saldoAkhir !== null && saldoAkhir < 0;
  const selisih = saldoFisik !== "" && saldoAkhir !== null ? Number(saldoFisik) - saldoAkhir : null;

  async function simpan() {
    setErr(null);
    if (pertama && saldoAwalInput === "") return setErr("Isi saldo awal kas station (uang kas saat mulai mencatat).");
    if (sudahAda) return setErr(`Tanggal ${tgl(tanggal)} sudah punya catatan — buka catatan itu untuk menambah transaksi.`);
    if (!pertama && !sebelum) return setErr(`Tanggal tidak boleh sebelum catatan pertama station (${tgl(tertua!)}).`);
    if (batas && tanggal <= batas) return setErr(`Tanggal sampai ${tgl(batas)} terkunci — minggu itu sudah diajukan ke pusat.`);
    for (const [i, b] of terisi.entries()) {
      if (nominalAngka(b) <= 0) return setErr(`Transaksi ${i + 1}: isi nominalnya.`);
      if (!b.uraian.trim()) return setErr(`Transaksi ${i + 1}: isi uraian (untuk apa uangnya).`);
    }
    if (minus) return setErr("Kas keluar melebihi saldo yang tersedia.");
    setBusy(true);
    try {
      await kasApi("harian", {
        method: "POST",
        body: {
          cabang, tanggal,
          ...(pertama ? { saldo_awal: Number(saldoAwalInput) } : {}),
          ...(saldoFisik !== "" ? { saldo_fisik: Number(saldoFisik) } : {}),
          keterangan: keterangan.trim() || undefined,
          transaksi: terisi.map((b) => ({ jenis: b.jenis, nominal: nominalAngka(b), uraian: b.uraian.trim(), bukti_ref: b.bukti_ref.trim() || undefined })),
        },
      });
      onSimpan();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Catat kas — {cabang}</DialogTitle>
          <DialogDescription>
            {pertama
              ? "Catatan pertama station: isi saldo awal (uang kas yang ada sekarang). Hari berikutnya saldo awal terisi otomatis."
              : "Tanggal boleh mundur untuk mencatat hari yang terlewat. Saldo awal otomatis dari catatan sebelum tanggal itu."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {err && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{err}</p>}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="kc-tgl">Tanggal</Label>
              <Input id="kc-tgl" type="date" min={tglMin} max={hariIni} value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            {pertama ? (
              <div className="space-y-1">
                <Label htmlFor="kc-awal">Saldo awal *</Label>
                <CurrencyInput id="kc-awal" value={saldoAwalInput} onChange={setSaldoAwalInput} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Saldo awal</Label>
                <p className="flex h-9 items-center rounded-md border bg-card px-3 text-sm font-medium tabular-nums">{saldoAwal === null ? "—" : rp(saldoAwal)}</p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="kc-ket">Keterangan hari ini</Label>
              <Input id="kc-ket" maxLength={500} placeholder="opsional" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
            </div>
          </div>

          {sudahAda ? (
            <p className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {tgl(tanggal)} sudah punya catatan.
              <Button type="button" size="sm" variant="soft" onClick={() => onBuka(sudahAda.id)}>Buka catatan itu</Button>
            </p>
          ) : !pertama && adaSesudah && sebelum ? (
            <p className="text-muted-foreground rounded-md border bg-card px-3 py-2 text-sm">
              Mencatat mundur: saldo awal diambil dari {tgl(sebelum.tanggal)}, dan saldo hari-hari sesudahnya ikut dihitung ulang otomatis.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label>Transaksi</Label>
            <div className="space-y-2">
              {trx.map((b, i) => (
                <TrxInput key={i} b={b} onChange={(p) => ubah(i, p)} autoFocus={i === trx.length - 1 && i > 0}
                  onHapus={trx.length > 1 ? () => setTrx((l) => l.filter((_, j) => j !== i)) : undefined} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="soft" onClick={() => setTrx((l) => [...l, trxKosong(l[l.length - 1]?.jenis)])}>
                <Plus /> Tambah transaksi
              </Button>
              <span className="text-muted-foreground text-xs">Tidak ada mutasi hari ini? Biarkan baris kosong — catatan tetap tersimpan.</span>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto]">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground text-xs">Saldo awal</dt><dd className="tabular-nums">{saldoAwal === null ? "—" : rp(saldoAwal)}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Masuk</dt><dd className="text-emerald-700 tabular-nums dark:text-emerald-400">+{rp(masuk)}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Keluar</dt><dd className="text-red-700 tabular-nums dark:text-red-400">−{rp(keluar)}</dd></div>
              <div>
                <dt className="text-muted-foreground text-xs">Saldo akhir</dt>
                <dd className={cn("text-base font-semibold tabular-nums", minus && "text-destructive")}>{saldoAkhir === null ? "—" : rp(saldoAkhir)}</dd>
              </div>
            </dl>
            <div className="space-y-1 sm:w-48">
              <Label htmlFor="kc-fisik" className="text-xs">Uang fisik di laci (opsional)</Label>
              <CurrencyInput id="kc-fisik" value={saldoFisik} onChange={setSaldoFisik} />
              {selisih !== null && (
                <p className={cn("text-xs font-medium", selisih === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
                  {selisih === 0 ? "Cocok dengan catatan" : `Selisih ${rpSelisih(selisih)}`}
                </p>
              )}
            </div>
            {minus && <p className="text-destructive text-sm sm:col-span-2">Kas keluar melebihi saldo yang tersedia — periksa nominalnya.</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button onClick={simpan} disabled={busy || minus || !!sudahAda}>{busy ? "Menyimpan…" : "Simpan catatan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
