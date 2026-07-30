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
import { Input } from "@/components/ui/input";
import { PilihanBaris } from "@/components/kso/shared";
import type { KsoKategori, KsoMaster } from "@/lib/kso/types";

import { HematoPanel } from "./hemato-panel";
import { KkPanel } from "./kk-panel";

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

// Urutan tab. Lima kategori sisanya (Crossmatch, CLIA, HPLC, Elektrolit,
// Blood Gas) menyusul — master datanya sudah ada di DB, tinggal layarnya.
const KATEGORI: { key: KsoKategori; label: string }[] = [
  { key: "HEMATO", label: "Hematologi" },
  { key: "CC", label: "Kimia Klinik" },
];

const SEGERA: { key: KsoKategori; label: string }[] = [
  { key: "XM", label: "Crossmatch" },
  { key: "CLIA", label: "CLIA" },
  { key: "HPLC", label: "HPLC" },
  { key: "ELEKTRO", label: "Elektrolit" },
  { key: "BG", label: "Blood Gas" },
];

export function KsoView({ master }: { master: KsoMaster | null }) {
  const [umum, setUmumState] = useState<Umum>(UMUM_AWAL);
  const [kategori, setKategori] = useState<KsoKategori>("HEMATO");
  const [halaman, setHalaman] = useState<"input" | "hasil">("input");

  const setUmum = (patch: Partial<Umum>) => setUmumState((p) => ({ ...p, ...patch }));

  if (!master) {
    return (
      <EmptyState
        title="Master tidak bisa dimuat"
        description="Pastikan apps/api jalan & DATABASE_URL aktif."
      />
    );
  }
  if (master.analyzers.length === 0) {
    return (
      <EmptyState
        title="Master Simulator KSO belum diimpor"
        description="Tabel kso_analyzer masih kosong. Jalankan scripts/db/import_kso_master.py --file <JSON di folder Drive> --db <db> --apply."
      />
    );
  }

  const perKategori = (k: KsoKategori) => master.analyzers.filter((a) => a.kategori === k);
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PilihanBaris
            label="Kategori"
            value={kategori}
            options={KATEGORI}
            onChange={(k) => {
              setKategori(k);
              setHalaman("input");
            }}
          />
          <span className="text-muted-foreground text-xs">
            Menyusul: {SEGERA.map((s) => s.label).join(" · ")}
          </span>
        </div>
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
        <HematoPanel
          analyzers={perKategori("HEMATO")}
          umum={umum}
          setUmum={setUmum}
          halaman={halaman}
          keHasil={() => setHalaman("hasil")}
        />
      ) : null}

      {kategori === "CC" ? (
        <KkPanel
          analyzers={perKategori("CC")}
          parameters={master.parameters.filter((p) => p.grup === "CC")}
          panels={panelKk}
          umum={umum}
          setUmum={setUmum}
          halaman={halaman}
          keHasil={() => setHalaman("hasil")}
        />
      ) : null}
    </div>
  );
}
