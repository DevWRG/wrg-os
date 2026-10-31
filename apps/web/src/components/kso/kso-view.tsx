"use client";

// Kerangka Simulator KSO: informasi kunjungan, pilih kategori, lalu dua
// halaman (Input → Hasil) seperti aplikasi asalnya.
//
// Kenapa dua halaman dan bukan satu layar panjang: yang dipakai sales di depan
// faskes cuma halaman hasil, sedangkan halaman input penuh angka nego yang tidak
// perlu dilihat customer. Memisahnya membuat layar hasil bisa langsung
// ditunjukkan tanpa menggulir melewati harga beli.

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PilihanBaris } from "@/components/kso/shared";
import type { KsoKategori, KsoMaster } from "@/lib/kso/types";

import { BgPanel } from "./bg-panel";
import { CliaPanel } from "./clia-panel";
import { ElektroPanel } from "./elektro-panel";
import { HematoPanel } from "./hemato-panel";
import { HplcPanel } from "./hplc-panel";
import { KkPanel } from "./kk-panel";
import { XmPanel } from "./xm-panel";
import { HargaBeliPanel } from "./harga-beli-panel";
import { terapkanBasis, type BasisHarga } from "@/lib/kso/basis";

/** Angka & keterangan yang berlaku lintas kategori. */
export interface Umum {
  salesName: string;
  faskesName: string;
  kotaKab: string;
  kompetitor: string;
  ups: number;
  lis: number;
  workDays: number;
  backupOn: boolean;
  backupKode: string | null;
  backupPrice: number;
  backupDisc: number;
}

const UMUM_AWAL: Umum = {
  salesName: "", faskesName: "", kotaKab: "", kompetitor: "",
  ups: 0, lis: 0, workDays: 0,
  backupOn: false, backupKode: null, backupPrice: 0, backupDisc: 0,
};

// Urutan tab — tujuh kategori, sama dengan aplikasi asal.
const KATEGORI: { key: KsoKategori; label: string }[] = [
  { key: "HEMATO", label: "Hematologi" },
  { key: "CC", label: "Kimia Klinik" },
  { key: "XM", label: "Crossmatch" },
  { key: "CLIA", label: "CLIA" },
  { key: "HPLC", label: "HPLC" },
  { key: "ELEKTRO", label: "Elektrolit" },
  { key: "BG", label: "Blood Gas" },
];

export function KsoView({ master: masterAsli, kelolaHargaBeli = false }: { master: KsoMaster | null; kelolaHargaBeli?: boolean }) {
  const [umum, setUmumState] = useState<Umum>(UMUM_AWAL);
  const [basis, setBasis] = useState<BasisHarga>("beli");
  const [kelola, setKelola] = useState(false);
  const [kategori, setKategori] = useState<KsoKategori>("HEMATO");
  const [halaman, setHalaman] = useState<"input" | "hasil">("input");

  const setUmum = (patch: Partial<Umum>) => setUmumState((p) => ({ ...p, ...patch }));

  if (kelola) return <HargaBeliPanel onTutup={() => setKelola(false)} />;
  if (!masterAsli) {
    return (
      <EmptyState
        title="Master tidak bisa dimuat"
        description="Pastikan apps/api jalan & DATABASE_URL aktif."
      />
    );
  }
  if (masterAsli.analyzers.length === 0) {
    return (
      <EmptyState
        title="Master Simulator KSO belum diimpor"
        description="Tabel kso_analyzer masih kosong. Jalankan scripts/db/import_kso_master.py --file <JSON di folder Drive> --db <db> --apply."
      />
    );
  }

  const master = terapkanBasis(masterAsli, basis);
  const perKategori = (k: KsoKategori) => master.analyzers.filter((a) => a.kategori === k);
  // cakupan harga beli di kategori yang sedang dibuka (reagen + parameter platformnya)
  const itemKat = [
    ...masterAsli.analyzers.filter((a) => a.kategori === kategori).flatMap((a) => a.reagents),
    ...masterAsli.parameters.filter((p) => (kategori === "CC" ? p.grup === "CC" : kategori === "CLIA" ? p.grup !== "CC" : false)),
  ];
  const tanpaBeli = itemKat.filter((x) => x.hargaBeli == null).length;
  const alatTanpaHpp = masterAsli.analyzers.filter((a) => a.kategori === kategori && a.hppAlat == null).length;
  const panelKk = master.panels.filter((p) => p.grup === "CC").map((p) => p.nama);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Informasi kunjungan</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["salesName", "Nama sales"],
            ["faskesName", "Nama faskes"],
            ["kotaKab", "Kota / kabupaten"],
            ["kompetitor", "Informasi kompetitor"],
          ] as const).map(([field, label]) => (
            <label key={field} className="block space-y-1">
              <span className="text-muted-foreground text-xs font-medium">{label}</span>
              <Input
                value={umum[field]}
                onChange={(e) => setUmum({ [field]: e.target.value } as Partial<Umum>)}
                className="bg-card"
                placeholder="—"
              />
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="space-y-1">
          <PilihanBaris
            label="Basis harga"
            value={basis}
            options={[
              { key: "beli" as const, label: "Harga beli (Finance)" },
              { key: "daftar" as const, label: "Harga daftar (lama)" },
            ]}
            onChange={setBasis}
          />
          <p className="text-muted-foreground text-xs">
            {basis === "beli"
              ? <>Reagen/kit pakai harga beli WRG; alat pakai HPP (HPP standar Finance / aset tetap).
                {tanpaBeli > 0 && <> <b className="text-amber-700 dark:text-amber-400">{tanpaBeli} dari {itemKat.length} barang</b> kategori ini belum punya harga beli — memakai harga lama.</>}
                {alatTanpaHpp > 0 && <> {alatTanpaHpp} alat tanpa HPP — memakai harga daftar.</>}</>
              : "Perilaku lama: price list / harga distributor — biaya bisa terlihat 2–4× di atas harga beli."}
          </p>
        </div>
        {kelolaHargaBeli && <Button size="sm" variant="outline" onClick={() => setKelola(true)}>Kelola harga beli</Button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PilihanBaris
          label="Kategori"
          value={kategori}
          options={KATEGORI.filter((k) => perKategori(k.key).length > 0)}
          onChange={(k) => {
            setKategori(k);
            setHalaman("input");
          }}
        />
        <PilihanBaris
          value={halaman}
          options={[
            { key: "input" as const, label: "Input & price list" },
            { key: "hasil" as const, label: "Hasil perhitungan" },
          ]}
          onChange={setHalaman}
        />
      </div>

      {kategori === "HEMATO" ? (
        <HematoPanel key={basis}
          analyzers={perKategori("HEMATO")}
          umum={umum}
          setUmum={setUmum}
          halaman={halaman}
          keHasil={() => setHalaman("hasil")}
        />
      ) : null}

      {kategori === "CC" ? (
        <KkPanel key={basis}
          analyzers={perKategori("CC")}
          parameters={master.parameters.filter((p) => p.grup === "CC")}
          panels={panelKk}
          umum={umum}
          setUmum={setUmum}
          halaman={halaman}
          keHasil={() => setHalaman("hasil")}
        />
      ) : null}

      {kategori === "XM" ? (
        <XmPanel key={basis} analyzers={perKategori("XM")} umum={umum} setUmum={setUmum}
          halaman={halaman} keHasil={() => setHalaman("hasil")} />
      ) : null}

      {kategori === "CLIA" ? (
        <CliaPanel key={basis}
          analyzers={perKategori("CLIA")}
          // Parameter CLIA dikirim utuh (SNIBE + WONDFO); panel-nya yang memisah
          // per grup, karena satu platform bisa dilihat bergantian tanpa reload.
          parameters={master.parameters.filter((p) => p.grup !== "CC")}
          panels={master.panels.filter((p) => p.grup !== "CC")}
          umum={umum} setUmum={setUmum}
          halaman={halaman} keHasil={() => setHalaman("hasil")} />
      ) : null}

      {kategori === "HPLC" ? (
        <HplcPanel key={basis} analyzers={perKategori("HPLC")} umum={umum} setUmum={setUmum}
          halaman={halaman} keHasil={() => setHalaman("hasil")} />
      ) : null}

      {kategori === "ELEKTRO" ? (
        <ElektroPanel key={basis} analyzers={perKategori("ELEKTRO")} umum={umum} setUmum={setUmum}
          halaman={halaman} keHasil={() => setHalaman("hasil")} />
      ) : null}

      {kategori === "BG" ? (
        <BgPanel key={basis} analyzers={perKategori("BG")} umum={umum} setUmum={setUmum}
          halaman={halaman} keHasil={() => setHalaman("hasil")} />
      ) : null}
    </div>
  );
}
