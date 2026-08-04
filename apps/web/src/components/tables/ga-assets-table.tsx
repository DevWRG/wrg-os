"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaAssetRowActions } from "@/components/crm/ga-asset-row-actions";

export interface GaAsset {
  id: string;
  asset_code: string;
  nama: string;
  category_id: string;
  category_nama: string;
  is_shared_category: boolean;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  warranty_expiry: string | null;
  location: string | null;
  current_pic_user_id: string | null;
  pic_name: string | null;
  department: string | null;
  condition: string;
  status: string;
  foto_path: string | null;
  dokumen_path: string | null;
  notes: string | null;
  is_critical: boolean;
  active: boolean;
}

const CONDITION_LABEL: Record<string, string> = { baik: "Baik", rusak: "Rusak", kurang_layak_pakai: "Kurang layak" };
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  active: "outline", in_maintenance: "secondary", damaged: "destructive", lost: "destructive", disposed: "secondary",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Aktif", in_maintenance: "Maintenance", damaged: "Rusak", lost: "Hilang", disposed: "Disposed",
};

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export function GaAssetsTable({ assets, categories }: { assets: GaAsset[]; categories: { id: string; nama: string }[] }) {
  const columns: DataColumn<GaAsset>[] = [
    {
      id: "kode",
      header: "Aset",
      sortable: true,
      accessor: (a) => a.asset_code,
      cell: (a) => (
        <div>
          <div className="font-medium">{a.asset_code}</div>
          <div className="text-muted-foreground text-xs">{a.nama}</div>
        </div>
      ),
    },
    { id: "kategori", header: "Kategori", cell: (a) => a.category_nama },
    { id: "lokasi", header: "Lokasi", cell: (a) => a.location ?? <span className="text-muted-foreground text-xs">-</span> },
    {
      id: "pic",
      header: "PIC",
      cell: (a) => a.pic_name ?? <span className="text-muted-foreground text-xs">belum di-assign</span>,
    },
    { id: "nilai", header: "Nilai Sekarang", align: "right", cell: (a) => rupiah(a.current_value) },
    {
      id: "kondisi",
      header: "Kondisi",
      cell: (a) => <Badge variant={a.condition === "baik" ? "outline" : "secondary"}>{CONDITION_LABEL[a.condition] ?? a.condition}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      cell: (a) => <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{STATUS_LABEL[a.status] ?? a.status}</Badge>,
    },
    {
      id: "kritis",
      header: "Kritis",
      cell: (a) => (a.is_critical ? <Badge variant="destructive">Kritis</Badge> : <span className="text-muted-foreground text-xs">-</span>),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (a) => <GaAssetRowActions asset={a} categories={categories} /> },
  ];

  return (
    <DataTable columns={columns} data={assets} getKey={(a) => a.id} searchPlaceholder="Cari kode aset / nama / serial…" pageSize={25} />
  );
}
