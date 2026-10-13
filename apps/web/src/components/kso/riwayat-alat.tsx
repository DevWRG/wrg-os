"use client";

// F169 — Riwayat Alat di dialog detail faskes (migrasi 217).
//
// Faskes-minded: satu faskes menampilkan SEMUA alat yang pernah berada di sana,
// termasuk yang sudah pindah, lengkap dengan dari mana alat datang dan ke mana
// pergi. Tes per baris = tes laporan teknisi selama alat di lokasi itu, sehingga
// faskes lama tetap memegang riwayatnya sendiri.
//
// Tulis (catat pindah / batalkan) hanya untuk pemegang izin edit 'kso-simulator';
// gerbangnya tetap di BFF — `bolehCatat` cuma menyembunyikan tombol.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, History, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import { num } from "./produktivitas-shared";

interface Penempatan {
  id: number; assetId: number; snKey: string; snRaw: string | null;
  typeAlat: string | null; namaAlat: string | null; skema: string;
  accountId: number | null; faskes: string | null; customerRaw: string;
  mulai: string | null; selesai: string | null; terbuka: boolean;
  sumber: string; catatan: string | null; dicatatOleh: string; dicatatAt: string;
  tes: number | null; bulanLapor: number;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// Diurai dari string, bukan lewat Date: kolom date + Date() bergeser ke UTC di WIB.
const tgl = (s: string | null) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
const hariIni = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const SUMBER: Record<string, string> = {
  awal: "lokasi saat riwayat mulai dicatat",
  sheet: "impor sheet Populasi Alat",
  manual: "dicatat di menu",
  sistem: "otomatis",
};

export function RiwayatAlat({ accountId, bolehCatat }: { accountId: number; bolehCatat: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Penempatan[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [formAlat, setFormAlat] = useState<number | null>(null);
  const [versi, setVersi] = useState(0);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let batal = false;
    fetch(`/api/kso/penempatan/faskes/${accountId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { rows: Penempatan[] }) => { if (!batal) { setRows(j.rows); setGalat(null); } })
      .catch(() => { if (!batal) setGalat("Riwayat alat gagal dimuat."); });
    return () => { batal = true; };
  }, [accountId, versi]);

  // Sesudah menulis: muat ulang riwayat + segarkan halaman (tabel per faskes dibaca
  // dari snapshot yang baru disegarkan API).
  const berubah = useCallback(() => {
    setFormAlat(null);
    setVersi((v) => v + 1);
    router.refresh();
  }, [router]);

  const batalkan = (p: Penempatan) => confirm({
    title: "Batalkan catatan pindah?",
    description: `${p.namaAlat ?? p.snKey} kembali tercatat di lokasi sebelumnya, seolah pindah ke "${p.faskes ?? p.customerRaw}" tidak pernah terjadi.`,
    confirmLabel: "Batalkan pindah",
    destructive: true,
  }, async () => {
    const r = await fetch("/api/kso-penempatan/batal", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ asset_id: p.assetId }),
    });
    if (r.ok) berubah();
    else setGalat(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Gagal membatalkan.");
  });

  if (!rows && !galat) return <Skeleton className="h-24 w-full motion-reduce:animate-none" />;

  const perAlat = new Map<number, Penempatan[]>();
  for (const p of rows ?? []) perAlat.set(p.assetId, [...(perAlat.get(p.assetId) ?? []), p]);
  const adaPindah = [...perAlat.values()].some((ps) => ps.length > 1);

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <History className="size-3.5" /> Riwayat alat ({perAlat.size})
      </div>
      {galat ? <p className="mb-2 text-xs text-red-600">{galat}</p> : null}
      {!adaPindah && rows?.length ? (
        <p className="text-muted-foreground mb-2 text-[11px]">
          Belum ada alat yang tercatat pindah masuk/keluar faskes ini.
        </p>
      ) : null}
      <div className="space-y-2">
        {[...perAlat.entries()].map(([assetId, ps]) => {
          const buka = ps.find((p) => p.terbuka) ?? null;
          const masihDiSini = buka?.accountId === accountId;
          return (
            <div key={assetId} className="border-border rounded-lg border p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs">
                  <span className="font-medium">{ps[0].namaAlat ?? ps[0].typeAlat ?? "—"}</span>
                  <span className="text-muted-foreground"> · SN {ps[0].snRaw ?? ps[0].snKey}</span>
                </div>
                {bolehCatat && masihDiSini && formAlat !== assetId ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFormAlat(assetId)}>
                    Catat pindah / tarik
                  </Button>
                ) : null}
              </div>
              <ol className="mt-1.5 space-y-1">
                {ps.map((p) => {
                  const diSini = p.accountId === accountId;
                  return (
                    <li key={p.id} className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]",
                      !diSini && "text-muted-foreground")}>
                      <span className="tabular-nums">
                        {tgl(p.mulai) ?? "awal tercatat"} <ArrowRight className="inline size-3" /> {tgl(p.selesai) ?? "sekarang"}
                      </span>
                      <span className={cn(diSini && "text-foreground font-medium")}>{p.faskes ?? p.customerRaw}</span>
                      {p.accountId === null && !/^\s*stok\s+kantor/i.test(p.customerRaw) ? (
                        <span className="text-amber-600">(belum terpeta ke customer Accurate)</span>
                      ) : null}
                      <span className="tabular-nums">
                        {p.tes === null ? "tanpa laporan tes" : `${num(p.tes)} tes · ${p.bulanLapor} bln`}
                      </span>
                      <span title={[SUMBER[p.sumber] ?? p.sumber, p.catatan, `oleh ${p.dicatatOleh}`].filter(Boolean).join(" — ")}
                        className="text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
                        {SUMBER[p.sumber] ?? p.sumber}
                      </span>
                      {bolehCatat && p.terbuka && (p.sumber === "manual" || p.sumber === "sheet") && ps.length > 1 ? (
                        <button type="button" onClick={() => batalkan(p)}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 underline underline-offset-2">
                          <Undo2 className="size-3" /> batalkan
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {formAlat === assetId && buka ? (
                <FormPindah assetId={assetId} mulaiSekarang={buka.mulai} onBatal={() => setFormAlat(null)} onSelesai={berubah} />
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        Tes bulan pindah ikut lokasi dengan hari terbanyak di bulan itu. Revenue tidak perlu
        dipindah — faktur Accurate memang terbit atas nama faskes.
      </p>
      {dialog}
    </div>
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
      fetch(`/api/kso/penempatan/cari-faskes?q=${encodeURIComponent(cari.trim())}`)
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
