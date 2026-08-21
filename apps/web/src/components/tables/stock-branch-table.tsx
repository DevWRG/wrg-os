"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface WarehouseCol {
  kode: string;
  nama: string;
  cabang: string | null;
  aktif: boolean;
}

export interface StockBranchRow {
  item_id: string;
  no: string;
  name: string;
  unit: string | null;
  total: number | null;
  per_gudang: Record<string, number>;
  jumlah_cabang: number;
  selisih: number | null;
  ada_data_cabang: boolean;
  terakhir_update: string | null;
  sumber: string[];
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("id-ID").format(n);

// Sentinel sort untuk sel "belum diisi" — selalu di ujung, terpisah dari 0
// (= sudah dihitung, habis) dan dari nilai negatif.
//
// BUKAN -Infinity: komparator DataTable memakai `av - bv`, dan
// `-Infinity - (-Infinity)` = NaN → urutan sort jadi tak terdefinisi saat dua
// sel sama-sama kosong. BUKAN -1 juga: itu bisa bentrok dengan qty negatif
// sungguhan. `-MAX_SAFE_INTEGER` aman untuk pengurangan dan mustahil tercapai
// oleh stok nyata.
//
// Kolom yang memakainya di-set `searchable: false` agar angka sentinel tak ikut
// jadi teks yang dicocokkan kotak pencarian.
const TAK_ADA = -Number.MAX_SAFE_INTEGER;

export function StockBranchTable({
  rows,
  warehouses,
}: {
  rows: StockBranchRow[];
  warehouses: WarehouseCol[];
}) {
  // Kolom gudang = gudang aktif DITAMBAH gudang nonaktif yang masih memegang
  // stok di salah satu baris. Tanpa penambahan itu, stok di gudang yang baru
  // dinonaktifkan tetap ikut dijumlahkan di Σ Cabang tapi tak punya kolom —
  // pembaca menjumlahkan kolom yang terlihat dan hasilnya tidak cocok dengan Σ,
  // tanpa cara apa pun melacak sisanya. Migrasi 082 sengaja menonaktifkan
  // (bukan menghapus) gudang, jadi keadaan ini pasti terjadi tiap ada gudang
  // ditutup/digabung.
  const columns = useMemo<DataColumn<StockBranchRow>[]>(() => {
    const known = new Set(warehouses.map((w) => w.kode));
    const extra = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.per_gudang)) if (!known.has(k)) extra.add(k);
    }
    const cols: WarehouseCol[] = [
      ...warehouses,
      ...[...extra].sort().map((kode) => ({ kode, nama: `${kode} (nonaktif)`, cabang: null, aktif: false })),
    ];

    return [
      {
        id: "no",
        header: "SKU",
        sortable: true,
        accessor: (r) => r.no,
        // sticky: matriks bisa >1.900px sementara area konten ~1.150px. Tanpa ini
        // SKU ikut ter-scroll keluar saat membaca kolom NTB/NTT, dan angkanya
        // kehilangan identitas baris — padahal membandingkan antar-gudang per SKU
        // itu justru gunanya tabel ini.
        cell: (r) => <span className="font-medium whitespace-nowrap">{r.no}</span>,
        className: "bg-card sticky left-0 z-10",
      },
      {
        id: "name",
        header: "Nama",
        sortable: true,
        accessor: (r) => r.name,
        cell: (r) => (
          <span className="block max-w-[18rem] truncate" title={r.name}>
            {r.name}
          </span>
        ),
        className: "max-w-[18rem]",
      },
      {
        id: "total",
        header: "Total (Accurate)",
        align: "right",
        sortable: true,
        searchable: false,
        accessor: (r) => r.total ?? TAK_ADA,
        cell: (r) => <span className="whitespace-nowrap font-medium">{fmt(r.total)}</span>,
        className: "whitespace-nowrap",
      },
      // Satu kolom per gudang. Tiga keadaan sel dibedakan tegas: "—" belum diisi,
      // "0" sudah dihitung & habis, angka = stok.
      ...cols.map<DataColumn<StockBranchRow>>((w) => ({
        id: `wh-${w.kode}`,
        header: w.kode,
        align: "right",
        sortable: true,
        searchable: false,
        accessor: (r) => r.per_gudang[w.kode] ?? TAK_ADA,
        cell: (r) => {
          const v = r.per_gudang[w.kode];
          if (v == null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={`whitespace-nowrap ${v === 0 ? "text-muted-foreground" : ""}`}>
              {fmt(v)}
            </span>
          );
        },
        className: w.aktif ? "whitespace-nowrap" : "whitespace-nowrap text-warning",
      })),
      {
        id: "jumlah_cabang",
        header: "Σ Cabang",
        align: "right",
        sortable: true,
        searchable: false,
        accessor: (r) => r.jumlah_cabang,
        cell: (r) => <span className="whitespace-nowrap">{fmt(r.jumlah_cabang)}</span>,
        className: "whitespace-nowrap",
      },
      {
        id: "selisih",
        header: "Total − Σ Cabang",
        align: "right",
        sortable: true,
        searchable: false,
        // Kunci sort HARUS sama dengan yang tampil. Baris tanpa data cabang &
        // baris yang total-nya belum sinkron tidak menampilkan angka, jadi
        // keduanya didorong ke ujung — bukan ikut diurutkan seolah punya nilai
        // (dulu "belum diisi" ter-sort sebagai `total - 0` = total penuh, sehingga
        // sort desc penuh badge "belum diisi" dan selisih negatif — satu-satunya
        // sinyal integritas — terdampar di halaman terakhir).
        accessor: (r) => (!r.ada_data_cabang || r.selisih == null ? TAK_ADA : r.selisih),
        cell: (r) => {
          if (!r.ada_data_cabang) return <Badge variant="outline">belum diisi</Badge>;
          // Total bisa NULL untuk item non-stok/jasa (accurate_item.quantity
          // nullable). Tanpa cabang eksplisit ini badge-nya jadi "+—".
          if (r.selisih == null) {
            return (
              <Badge variant="outline" title="accurate_item.quantity kosong — item non-stok atau mirror belum sinkron">
                total belum sinkron
              </Badge>
            );
          }
          if (r.selisih === 0) return <Badge variant="secondary">cocok</Badge>;
          if (r.selisih < 0) {
            return (
              <Badge variant="destructive" title="Stok cabang melebihi total Accurate — mustahil, data perlu dicek">
                {fmt(r.selisih)} ⚠
              </Badge>
            );
          }
          return (
            <Badge variant="outline" title="Bisa barang di gudang customer (wajar), bisa juga data cabang belum lengkap">
              +{fmt(r.selisih)}
            </Badge>
          );
        },
      },
      {
        id: "sumber",
        header: "Sumber",
        accessor: (r) => r.sumber.join(","),
        cell: (r) =>
          r.sumber.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="text-muted-foreground text-xs">{r.sumber.join(", ")}</span>
          ),
      },
    ];
  }, [rows, warehouses]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      getKey={(r) => r.item_id}
      searchPlaceholder="Cari SKU / nama item…"
      pageSize={25}
    />
  );
}
