"use client";

// Tabel Daftar Alat. Status & sumbernya datang jadi dari API (kso_asset_status_v,
// migrasi 197) — komponen ini tidak menafsirkan ulang status apa pun, hanya
// menampilkan dan memfilter.

import { useMemo, useState } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { FilterSelect } from "@/components/ui/filter-select";

export interface KsoAlatRow {
  assetId: number;
  snKey: string;
  snRaw: string | null;
  namaAlat: string | null;
  typeAlat: string | null;
  customerRaw: string;
  faskes: string | null;
  accountId: number | null;
  kota: string | null;
  outlet: string | null;
  station: string | null;
  skema: string;
  pemilikAlat: string | null;
  tglSj: string | null;
  statusKode: string;
  statusLabel: string;
  statusSumber: string;
  operasional: boolean;
  masukProduktivitas: boolean;
  penanda: string[];
  rataTesBulanan: number | null;
  capaianTarget: number | null;
  updatedAt: string | null;
}

export interface KsoAlat {
  rows: KsoAlatRow[];
  perStatus: Array<{ kode: string; label: string; jumlah: number }>;
}

// Warna per status. Operasional hijau; yang tidak beroperasi abu/kuning; yang
// datanya belum jelas merah — itu yang perlu tindakan.
const WARNA: Record<string, string> = {
  operasional: "bg-emerald-50 text-emerald-700 border-emerald-200",
  stok_kantor: "bg-slate-50 text-slate-700 border-slate-200",
  backup: "bg-amber-50 text-amber-700 border-amber-200",
  not_ready: "bg-amber-50 text-amber-700 border-amber-200",
  nonaktif: "bg-slate-100 text-slate-600 border-slate-300",
  perlu_cek: "bg-red-50 text-red-700 border-red-200",
};

const SKEMA: Record<string, string> = { PER_TEST: "Per tes", BELI_REAGEN: "Beli reagen", UNKNOWN: "Belum jelas" };

function StatusBadge({ r }: { r: KsoAlatRow }) {
  return (
    <span
      title={`Sumber: ${r.statusSumber}`}
      className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", WARNA[r.statusKode] ?? WARNA.perlu_cek)}
    >
      {r.statusLabel}
    </span>
  );
}

const unik = (xs: Array<string | null>) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "id"));

export function KsoAlatView({ data }: { data: KsoAlat }) {
  const [status, setStatus] = useState("");
  const [pemilik, setPemilik] = useState("");
  const [jenis, setJenis] = useState("");
  const [outlet, setOutlet] = useState("");

  const opsiJenis = useMemo(() => unik(data.rows.map((r) => r.typeAlat)), [data.rows]);
  const opsiOutlet = useMemo(() => unik(data.rows.map((r) => r.outlet)), [data.rows]);

  const rows = useMemo(
    () =>
      data.rows.filter(
        (r) =>
          (!status || r.statusKode === status) &&
          (!pemilik || (pemilik === "-" ? r.pemilikAlat === null : r.pemilikAlat === pemilik)) &&
          (!jenis || r.typeAlat === jenis) &&
          (!outlet || r.outlet === outlet),
      ),
    [data.rows, status, pemilik, jenis, outlet],
  );

  const cols: DataColumn<KsoAlatRow>[] = [
    { id: "alat", header: "Alat", sortable: true,
      accessor: (r) => `${r.namaAlat ?? ""} ${r.snKey} ${r.typeAlat ?? ""}`,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.namaAlat ?? "(tanpa nama)"}</div>
          <div className="text-muted-foreground truncate text-xs">
            SN {r.snRaw ?? r.snKey}{r.typeAlat ? ` · ${r.typeAlat}` : ""}
          </div>
        </div>
      ) },
    { id: "lokasi", header: "Lokasi", sortable: true,
      accessor: (r) => `${r.faskes ?? r.customerRaw} ${r.kota ?? ""} ${r.outlet ?? ""}`,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate">{r.faskes ?? r.customerRaw}</div>
          <div className="text-muted-foreground truncate text-xs">
            {[r.kota, r.outlet && `outlet ${r.outlet}`].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ) },
    { id: "status", header: "Status", sortable: true,
      accessor: (r) => r.statusLabel,
      cell: (r) => (
        <div className="max-w-[24rem] space-y-1">
          <StatusBadge r={r} />
          {/* Sumber ditulis di sel, bukan cuma di tooltip: user minta penanda
              "status alatnya dari mana" — tooltip tidak terlihat di HP. */}
          <div className="text-muted-foreground line-clamp-2 text-[11px]" title={r.statusSumber}>
            {r.statusSumber}
          </div>
          {/* Penanda menempel di sel status, bukan kolom sendiri: isinya catatan
              tentang status yang sama (belum di Populasi, faskes belum terpetakan),
              dan kolom terpisah membuat tabel melebar melewati layar 1440 px. */}
          {r.penanda.length ? (
            <ul className="space-y-0.5 text-[11px] text-amber-700">
              {r.penanda.map((p) => <li key={p} className="line-clamp-2" title={p}>• {p}</li>)}
            </ul>
          ) : null}
        </div>
      ) },
    { id: "skema", header: "Skema", sortable: true,
      accessor: (r) => SKEMA[r.skema] ?? r.skema },
    { id: "pemilik", header: "Pemilik", sortable: true,
      accessor: (r) => r.pemilikAlat ?? "",
      cell: (r) => r.pemilikAlat ?? <span className="text-muted-foreground text-xs">belum diisi</span> },
    { id: "produktivitas", header: "Rata tes/bln", align: "right", sortable: true, searchable: false,
      accessor: (r) => r.rataTesBulanan ?? -1,
      cell: (r) =>
        r.masukProduktivitas ? (
          <div>
            <div className="font-medium">
              {r.rataTesBulanan === null ? "—" : r.rataTesBulanan.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
            </div>
            {r.capaianTarget !== null ? (
              <div className="text-muted-foreground text-xs">
                {Math.round(r.capaianTarget * 100)}% target
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs" title="Tidak dihitung di Produktivitas KSO — lihat status & penanda">
            tidak dihitung
          </span>
        ) },
  ];

  const kolomExport: ExportColumn<KsoAlatRow>[] = [
    { header: "Nama alat", value: (r) => r.namaAlat },
    { header: "SN", value: (r) => r.snRaw ?? r.snKey },
    { header: "Jenis alat", value: (r) => r.typeAlat },
    { header: "Faskes (Accurate)", value: (r) => r.faskes },
    { header: "Nama di sheet", value: (r) => r.customerRaw },
    { header: "Kota", value: (r) => r.kota },
    { header: "Outlet", value: (r) => r.outlet },
    { header: "Skema", value: (r) => SKEMA[r.skema] ?? r.skema },
    { header: "Pemilik", value: (r) => r.pemilikAlat },
    { header: "Status", value: (r) => r.statusLabel },
    { header: "Sumber status", value: (r) => r.statusSumber },
    { header: "Masuk Produktivitas KSO", value: (r) => (r.masukProduktivitas ? "ya" : "") },
    { header: "Rata tes/bln", value: (r) => (r.rataTesBulanan === null ? null : Math.round(r.rataTesBulanan * 10) / 10) },
    { header: "Capaian target", value: (r) => r.capaianTarget },
    { header: "Penanda", value: (r) => r.penanda.join(" | ") },
    { header: "TGL SJ", value: (r) => r.tglSj },
  ];

  const total = data.rows.length;
  return (
    <div className="space-y-4">
      {/* Kartu status = SELURUH data, tidak ikut filter: menggambarkan populasi
          alat, bukan irisan yang sedang dilihat. Klik kartu = pasang filter. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.perStatus.map((s) => (
          <button
            key={s.kode}
            type="button"
            onClick={() => setStatus(status === s.kode ? "" : s.kode)}
            className={cn(
              "bg-card rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/50",
              status === s.kode && "ring-primary ring-2",
            )}
          >
            <div className="text-muted-foreground text-xs">{s.label}</div>
            <div className="text-2xl font-semibold tracking-tight">{s.jumlah.toLocaleString("id-ID")}</div>
            <div className="text-muted-foreground text-xs">{Math.round((s.jumlah / total) * 100)}% dari {total}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex items-start gap-2 py-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <p className="text-muted-foreground">
            <strong>Produktivitas KSO hanya menghitung alat berstatus Operasional</strong> yang faskesnya
            sudah dicocokkan ke customer Accurate. Status ditetapkan dari sheet <em>Populasi Alat</em>{" "}
            (kolom Customer, STATUS, Keterangan) dan tab realisasi 2026, dengan urutan: stok kantor →
            backup → not ready → nonaktif → operasional → perlu dicek. Kalau statusnya keliru, betulkan
            di sheet — kalimat <em>sumber</em> di bawah setiap status menyebut kolom mana.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Status" value={status} onChange={setStatus}
                options={data.perStatus.map((s) => ({ value: s.kode, label: s.label }))} />
              <FilterSelect label="Pemilik" value={pemilik} onChange={setPemilik}
                options={[{ value: "WRG", label: "WRG" }, { value: "PRINCIPAL", label: "Principal" },
                  { value: "CUSTOMER", label: "Customer" }, { value: "-", label: "Belum diisi" }]} />
              <FilterSelect label="Jenis" value={jenis} onChange={setJenis}
                options={opsiJenis.map((x) => ({ value: x, label: x }))} />
              <FilterSelect label="Outlet" value={outlet} onChange={setOutlet}
                options={opsiOutlet.map((x) => ({ value: x, label: x }))} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">{rows.length} dari {total} alat</span>
              <ExportButton filename="daftar-alat-wrg" columns={kolomExport} data={rows} label="Export CSV (sesuai filter)" />
            </div>
          </div>
          <DataTable
            columns={cols}
            data={rows}
            getKey={(r) => String(r.assetId)}
            searchPlaceholder="Cari alat, SN, faskes, kota…"
            pageSize={25}
            empty="Tidak ada alat pada filter ini."
          />
        </CardContent>
      </Card>
    </div>
  );
}
