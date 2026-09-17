"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { VendorRowActions } from "@/components/vendor-management/vendor-row-actions";
import { VendorDetailDialog } from "@/components/vendor-management/vendor-detail-dialog";

export interface VendorPartnerRow {
  id: string;
  name: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  cabang: string | null;
  accurate_vendor_id: string | null;
  is_active: boolean;
  notes: string | null;
  contract_count: number;
  expiring_count: number;
  expired_count: number;
}

export function VendorTable({ rows }: { rows: VendorPartnerRow[] }) {
  const [detailId, setDetailId] = useState<string | null>(null);

  const columns: DataColumn<VendorPartnerRow>[] = [
    {
      id: "name",
      header: "Vendor",
      sortable: true,
      accessor: (r) => r.name,
      cell: (r) => (
        <button type="button" onClick={() => setDetailId(r.id)} className="hover:text-primary text-left font-medium underline-offset-2 hover:underline">
          {r.name}
        </button>
      ),
    },
    { id: "category", header: "Kategori", sortable: true, accessor: (r) => r.category ?? "", cell: (r) => r.category ?? "—" },
    {
      id: "kontak",
      header: "Kontak",
      accessor: (r) => r.contact_person ?? "",
      cell: (r) => (
        <div className="text-sm">
          <div>{r.contact_person ?? "—"}</div>
          <div className="text-muted-foreground text-xs">{r.phone ?? r.email ?? ""}</div>
        </div>
      ),
    },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => r.cabang ?? "—" },
    {
      id: "kontrak",
      header: "Kontrak",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge className="bg-muted text-muted-foreground">{r.contract_count} total</Badge>
          {r.expiring_count > 0 && <Badge className="bg-warning-soft text-warning">{r.expiring_count} akan expired</Badge>}
          {r.expired_count > 0 && <Badge className="bg-danger-soft text-danger">{r.expired_count} expired</Badge>}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (r) => (r.is_active ? "aktif" : "nonaktif"),
      cell: (r) => (r.is_active ? <Badge className="bg-success-soft text-success">Aktif</Badge> : <Badge className="bg-muted text-muted-foreground">Nonaktif</Badge>),
    },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Detail" onClick={() => setDetailId(r.id)}>
            <Eye />
          </Button>
          <VendorRowActions row={r} />
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari nama vendor / kategori / cabang…" pageSize={25} />
      <VendorDetailDialog vendorId={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}
