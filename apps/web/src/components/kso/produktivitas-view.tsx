"use client";

// Panel TABEL — menelusuri satu faskes. Dirender sebagai tab oleh
// produktivitas-tabs.tsx, yang juga memegang keadaan filter dan merender FilterBarKso;
// panel ini hanya MENERIMA `f` supaya dua tab tidak pernah menyaring berbeda.

import { useState } from "react";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FaskesRow, FilterKso, Tag, num, rp, rupiahPerAlat, skemaPakaiRpTes } from "./produktivitas-shared";
import { FaskesDetailDialog } from "./faskes-detail-dialog";

export type { KsoProduktivitas, KsoProduktivitasRow } from "./produktivitas-shared";

export function KsoProduktivitasTabel({ f }: { f: FilterKso }) {
  const { rows, median } = f;
  const [detail, setDetail] = useState<FaskesRow | null>(null);

  const cols: DataColumn<FaskesRow>[] = [
    { id: "faskes", header: "Faskes", sortable: true,
      accessor: (g) => g.faskes,
      cell: (g) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{g.faskes}</div>
          <div className="text-muted-foreground truncate text-xs" title={g.alatList.join(", ")}>
            {[g.alatList.slice(0, 3).join(", ") + (g.alatList.length > 3 ? ` +${g.alatList.length - 3}` : ""),
              g.kota].filter(Boolean).join(" · ")}
          </div>
        </div>
      ) },
    { id: "tes", header: "Tes (customer)", align: "right", sortable: true,
      accessor: (g) => g.r.totalTesCustomerSeskema ?? 0,
      cell: (g) => num(g.r.totalTesCustomerSeskema) },
    { id: "alat", header: "Alat", align: "center", sortable: true,
      accessor: (g) => g.r.alatSeskemaDiCustomer ?? g.alatList.length,
      cell: (g) => g.r.alatSeskemaDiCustomer ?? g.alatList.length },
    { id: "revenue", header: "Revenue netto", align: "right", sortable: true,
      accessor: (g) => g.r.revenueNettoCustomer ?? 0,
      cell: (g) => rp(g.r.revenueNettoCustomer) },
    // Rp/tes HANYA untuk PER_TEST. Di BELI_REAGEN penyebutnya cuma 4 dari 329 aset, jadi
    // kolomnya diganti — bukan diisi angka yang tak berdasar. Nama kolomnya pun berbeda:
    // "Rp / alat" tidak boleh terbaca sebagai varian Rp/tes, karena yang diukur besar
    // BELANJA per alat, bukan produktivitas. Nama kolom bertahan lebih lama dari maknanya.
    ...(skemaPakaiRpTes(f.skema)
      ? [{ id: "rpt", header: "Rp / tes", align: "right" as const, sortable: true,
          accessor: (g: FaskesRow) => g.r.rupiahPerTesCustomer ?? 0,
          cell: (g: FaskesRow) => (
            <div>
              <div className={cn("font-medium", !g.r.basisTesMemadai && "text-muted-foreground")}>
                {rp(g.r.rupiahPerTesCustomer)}
              </div>
              {median && g.r.rupiahPerTesCustomer ? (
                <div className="text-muted-foreground text-xs">
                  {(g.r.rupiahPerTesCustomer / median).toFixed(2)}× median
                </div>
              ) : null}
            </div>
          ) }]
      : [{ id: "rpa", header: "Rp / alat", align: "right" as const, sortable: true,
          accessor: (g: FaskesRow) => rupiahPerAlat(g.r) ?? 0,
          cell: (g: FaskesRow) => (
            <div>
              <div className="font-medium">{rp(rupiahPerAlat(g.r))}</div>
              <div className="text-muted-foreground text-xs">belanja/alat</div>
            </div>
          ) }]),
    { id: "tanda", header: "Penanda",
      cell: (g) => (
        <div className="flex flex-wrap gap-1">
          {!g.r.basisTesMemadai ? <Tag warna="merah" judul="Penyebut < 100 tes/thn — jangan dipakai memeringkat">penyebut tipis</Tag> : null}
          {g.r.tagihPolaDatar ? <Tag warna="kuning" judul="Qty Accurate datar tiap bulan = minimum kontrak, bukan hitungan tes">minimum kontrak</Tag> : null}
          {g.r.revenueTumpangTindih ? <Tag warna="biru" judul={`Faskes berskema ganda; porsi KSO ${g.r.porsiKso ?? "—"}`}>skema ganda</Tag> : null}
          {g.r.statusPenagihan === "tanpa_faktur" ? <Tag warna="merah" judul="Tidak ada faktur atas nama faskes ini">tanpa faktur</Tag> : null}
        </div>
      ) },
    { id: "rasio", header: "Tagih / lapor", align: "right", sortable: true,
      accessor: (g) => g.r.rasioTagihLapor ?? -1,
      cell: (g) => (g.r.rasioTagihLapor === null
        ? <span className="text-muted-foreground text-xs">n/a</span>
        : <span className={cn(Math.abs(g.r.rasioTagihLapor - 1) > 0.25 && "text-amber-600 font-medium")}>
            {g.r.rasioTagihLapor.toFixed(2)}
          </span>) },
    // Kolom aksi EKSPLISIT walaupun seluruh barisnya sudah bisa diklik: baris yang
    // dapat diklik tidak punya penanda visual apa pun, jadi tanpa tombol ini
    // kemampuannya hanya diketahui orang yang kebetulan mencoba.
    { id: "aksi", header: "", align: "right", className: "w-px",
      cell: (g) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDetail(g); }}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-xs whitespace-nowrap"
        >
          Lihat detail <ChevronRight className="size-3.5" />
        </button>
      ) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start gap-2 py-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground">
            {skemaPakaiRpTes(f.skema) ? (
              <>
                <strong>Rp/tes dihitung di level customer</strong>, bukan per alat — revenue milik faskes,
                dan kolom “Alat” menunjukkan berapa alat seskema yang membagi angka itu.
              </>
            ) : (
              <>
                {/* Batas metriknya dinyatakan di tempat angkanya dibaca, bukan cuma di komentar
                    kode: yang memeringkat kolom ini perlu tahu ia bukan ukuran produktivitas. */}
                <strong>Skema ini tidak punya Rp/tes.</strong> Hanya 4 dari 329 alat melaporkan jumlah
                tes — di skema beli-reagen yang ditagih reagennya, bukan tesnya — jadi penyebut per-tes
                praktis tidak ada, dan menurunkannya dari reagen sudah diuji &amp; gagal (pembelian
                mengikuti siklus stok, bukan siklus tes). Yang tampil{" "}
                <strong>Rp/alat = besar belanja per alat</strong>, <em>bukan produktivitas</em>: ia tidak
                bisa menjawab apakah sebuah alat dipakai. Sebarannya juga ±3× lebih lebar dari Rp/tes,
                jadi perbedaan antar faskes lebih banyak mencerminkan <strong>ukuran</strong> faskes
                daripada efisiensinya.
              </>
            )}{" "}
            Kedua skema <strong>tidak sebanding</strong> satu sama lain, jadi peringkatnya terpisah.
            Kartu angka dan grafiknya ada di tab <strong>Ringkasan</strong>, dengan filter yang sama
            seperti di sini.
          </p>
        </CardContent>
      </Card>

      {!f.hanyaLayak ? (
        <Card className="border-amber-300">
          <CardContent className="flex items-start gap-2 py-3 text-xs">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              Filter “layak diperingkat” dimatikan. Baris berpenanda <em>penyebut tipis</em> punya
              kurang dari 100 tes setahun — Rp/tes-nya didominasi derau, dan mengurutkannya menurun
              menaikkan alat yang paling <em>tidak</em> terpakai ke puncak.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Tabel dibungkus Card supaya duduk di permukaan putih, tidak langsung di
          latar halaman — sama seperti panel lain di dashboard. */}
      <Card>
        <CardContent>
          <DataTable
            columns={cols}
            data={rows}
            getKey={(g) => g.key}
            searchPlaceholder="Cari faskes, alat, kota…"
            pageSize={25}
            initialSort={{ id: "rpt", dir: "desc" }}
            empty="Tidak ada faskes pada filter ini."
            onRowClick={setDetail}
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Aset yang skemanya belum ditentukan tidak muncul di halaman ini — kolom STATUS-nya
        kosong atau tidak dikenali di sheet <em>Populasi KSO</em>, sehingga tersaring di
        lapisan view. Perbaikannya di sheet, bukan di sini.
      </p>

      <FaskesDetailDialog g={detail} median={median} onClose={() => setDetail(null)} />
    </div>
  );
}
