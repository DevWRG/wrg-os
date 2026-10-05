"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { GaVendorRowActions } from "@/components/crm/ga-vendor-row-actions";

export interface GaVendor {
  id: string;
  nama: string;
  category: string | null;
  contact_person: string | null;
  phone: string | null;
  contract_end: string | null;
  notes: string | null;
  status: string;
}

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function GaVendorTable({ vendors }: { vendors: GaVendor[] }) {
  const columns: DataColumn<GaVendor>[] = [
    {
      id: "nama",
      header: "Vendor",
      sortable: true,
      accessor: (v) => v.nama,
      cell: (v) => (
        <div>
          <div className="font-medium">{v.nama}</div>
          {v.category && <div className="text-muted-foreground text-xs">{v.category}</div>}
        </div>
      ),
    },
    { id: "kontak", header: "Kontak", cell: (v) => v.contact_person ?? v.phone ?? <span className="text-muted-foreground text-xs">-</span> },
    { id: "kontrak", header: "Kontrak s/d", cell: (v) => (v.contract_end ? fmtDate(v.contract_end) : <span className="text-muted-foreground text-xs">-</span>) },
    { id: "status", header: "Status", cell: (v) => (v.status === "active" ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>) },
    { id: "aksi", header: "Aksi", align: "right", cell: (v) => <GaVendorRowActions vendor={v} /> },
  ];

  return <DataTable columns={columns} data={vendors} getKey={(v) => v.id} searchPlaceholder="Cari vendor…" pageSize={25} />;
}
