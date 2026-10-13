"use client";

// F169 — dialog Pindah / tarik alat di menu Daftar Alat (migrasi 217).
//
// HANYA untuk teknisi (kunci izin 'kso-mutasi-alat' tingkat edit; keputusan user
// 13 Okt 2026). Gerbang sebenarnya di BFF /api/kso-penempatan/* — dialog ini
// hanya dibuka dari tombol yang disembunyikan bagi yang tak berizin.
//
// Isinya: riwayat penempatan alat ini, form pindah/tarik, dan batalkan catatan
// pindah terakhir kalau salah catat. Tanggal = hari alat TIBA di lokasi baru
// (TGL SJ); tes bulan itu ikut lokasi dengan hari terbanyak.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { BarisPenempatan, type Penempatan } from "./penempatan-shared";

const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function MutasiAlatDialog({ alat, onClose }: {
  alat: { assetId: number; namaAlat: string | null; snLabel: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const assetId = alat?.assetId ?? null;
  const [hasil, setHasil] = useState<{ assetId: number; rows: Penempatan[] | null } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (assetId === null) return;
    let batal = false;
    fetch(`/api/kso-penempatan/alat/${assetId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { rows: Penempatan[] }) => { if (!batal) setHasil({ assetId, rows: j.rows }); })
      .catch(() => { if (!batal) setHasil({ assetId, rows: null }); });
    return () => { batal = true; };
  }, [assetId, versi]);

  // Sesudah menulis: muat ulang riwayat + segarkan tabel Daftar Alat (lokasinya berubah).
  const berubah = useCallback(() => {
    setGalat(null);
    setVersi((v) => v + 1);
    router.refresh();
  }, [router]);

  if (!alat) return null;
  const rows = hasil?.assetId === alat.assetId ? hasil.rows : undefined;
  const buka = rows?.find((p) => p.terbuka) ?? null;

  const batalkan = (p: Penempatan) => confirm({
    title: "Batalkan catatan pindah?",
    description: `${alat.namaAlat ?? alat.snLabel} kembali tercatat di lokasi sebelumnya, seolah pindah ke "${p.faskes ?? p.customerRaw}" tidak pernah terjadi.`,
    confirmLabel: "Batalkan pindah",
    destructive: true,
  }, async () => {
    const r = await fetch("/api/kso-penempatan/batal", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset_id: p.assetId }),
    }).catch(() => null);
    if (r?.ok) berubah();
    else setGalat(((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? "Gagal membatalkan.");
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">Pindah / tarik alat</DialogTitle>
          <p className="text-muted-foreground text-xs">{alat.namaAlat ?? "(tanpa nama)"} · SN {alat.snLabel}</p>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium">Riwayat lokasi</div>
            {rows === undefined ? <Skeleton className="h-12 w-full motion-reduce:animate-none" />
              : rows === null ? <p className="text-xs text-red-600">Riwayat gagal dimuat.</p>
              : (
                <ol className="space-y-1">
                  {rows.map((p) => (
                    <BarisPenempatan key={p.id} p={p} sorot={p.terbuka}
                      aksi={p.terbuka && (p.sumber === "manual" || p.sumber === "sheet") && rows.length > 1 ? (
                        <button type="button" onClick={() => batalkan(p)}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 underline underline-offset-2">
                          <Undo2 className="size-3" /> batalkan
                        </button>
                      ) : undefined} />
                  ))}
                </ol>
              )}
          </div>
          {galat ? <p className="text-xs text-red-600">{galat}</p> : null}
          {buka ? (
            <FormPindah key={buka.id} assetId={alat.assetId} mulaiSekarang={buka.mulai} onBatal={onClose} onSelesai={berubah} />
          ) : null}
        </DialogBody>
      </DialogContent>
      {dialog}
    </Dialog>
  );
}

function FormPindah({ assetId, mulaiSekarang, onBatal, onSelesai }: {
  assetId: number; mulaiSekarang: string | null; onBatal: () => void; onSelesai: () => void;
}) {
  const [tujuan, setTujuan] = useState<"faskes" | "stok" | "lainnya">("faskes");
  const [cari, setCari] = useState("");
  const [opsi, setOpsi] = useState<{ value: string; label: string }[]>([]);
  const [accountId, setAccountId] = useState("");
  const [lokasi, setLokasi] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [catatan, setCatatan] = useState("");
  const [kirim, setKirim] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  // Cari faskes di server (±2.700 customer Accurate — terlalu banyak untuk dimuat semua).
  useEffect(() => {
    if (tujuan !== "faskes" || cari.trim().length < 2) return;
    let batal = false;
    const t = setTimeout(() => {
      fetch(`/api/kso-penempatan/cari-faskes?q=${encodeURIComponent(cari.trim())}`)
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .then((j: { rows: { id: number; nama: string }[] }) => {
          if (!batal) setOpsi(j.rows.map((r) => ({ value: String(r.id), label: r.nama })));
        })
        .catch(() => {});
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [cari, tujuan]);

  const simpan = async () => {
    setGalat(null);
    if (!tanggal) return setGalat("Tanggal wajib diisi.");
    if (tujuan === "faskes" && !accountId) return setGalat("Pilih faskes tujuan.");
    if (tujuan === "lainnya" && !lokasi.trim()) return setGalat("Isi nama lokasi tujuan.");
    setKirim(true);
    const r = await fetch("/api/kso-penempatan/pindah", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asset_id: assetId, tujuan, tanggal, catatan,
        account_id: tujuan === "faskes" ? Number(accountId) : null,
        customer_raw: tujuan === "faskes" ? null : lokasi.trim(),
      }),
    }).catch(() => null);
    setKirim(false);
    if (r?.ok) return onSelesai();
    setGalat(((await r?.json().catch(() => ({}))) as { error?: string } | undefined)?.error ?? "Gagal menyimpan.");
  };

  return (
    <div className="bg-background mt-2 space-y-2.5 rounded-lg border border-dashed p-2.5">
      <div className="flex flex-wrap gap-3 text-xs">
        {([["faskes", "Pindah ke faskes lain"], ["stok", "Tarik ke stok kantor"], ["lainnya", "Lokasi lain (bukan customer Accurate)"]] as const)
          .map(([v, l]) => (
            <label key={v} className="flex items-center gap-1.5">
              <input type="radio" name={`tujuan-${assetId}`} checked={tujuan === v} onChange={() => setTujuan(v)} />
              {l}
            </label>
          ))}
      </div>
      {tujuan === "faskes" ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div>
            <Label htmlFor={`cari-${assetId}`} className="text-xs">Cari faskes tujuan</Label>
            <Input id={`cari-${assetId}`} value={cari} onChange={(e) => setCari(e.target.value)}
              placeholder="ketik minimal 2 huruf" className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Faskes tujuan</Label>
            <Combobox value={accountId} onChange={setAccountId} options={opsi}
              placeholder={opsi.length ? "— pilih —" : "cari dulu di kiri"} />
          </div>
        </div>
      ) : (
        <div>
          <Label htmlFor={`lokasi-${assetId}`} className="text-xs">
            {tujuan === "stok" ? "Keterangan stok (opsional, mis. READY / RUSAK)" : "Nama lokasi tujuan"}
          </Label>
          <Input id={`lokasi-${assetId}`} value={lokasi} onChange={(e) => setLokasi(e.target.value)} className="h-8 text-xs" />
        </div>
      )}
      <div className="grid gap-1.5 sm:grid-cols-2">
        <div>
          <Label htmlFor={`tgl-${assetId}`} className="text-xs">Tanggal tiba di lokasi baru (TGL SJ)</Label>
          <Input id={`tgl-${assetId}`} type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)}
            min={mulaiSekarang ?? undefined} max={hariIni()} className="h-8 text-xs" />
        </div>
        <div>
          <Label htmlFor={`cat-${assetId}`} className="text-xs">Catatan (opsional)</Label>
          <Textarea id={`cat-${assetId}`} value={catatan} onChange={(e) => setCatatan(e.target.value)}
            rows={1} className="min-h-8 text-xs" />
        </div>
      </div>
      {galat ? <p className="text-xs text-red-600">{galat}</p> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onBatal} disabled={kirim}>Batal</Button>
        <Button size="sm" className="h-7 text-xs" onClick={simpan} disabled={kirim}>
          {kirim ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>
    </div>
  );
}
