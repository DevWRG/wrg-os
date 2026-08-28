"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { VehicleRowActions } from "@/components/crm/vehicle-row-actions";

export interface Vehicle {
  id: string;
  plate_number: string;
  model: string | null;
  sopir_name: string | null;
  current_km: number | null;
  stnk_expiry: string | null;
  service_interval_km: number;
  last_service_km: number | null;
  last_service_date: string | null;
  active: boolean;
  service_due: boolean;
  stnk_due: boolean;
  stnk_days_left: number | null;
  bbm_liter_bulan_ini: number;
  bbm_cost_bulan_ini: number;
}

const fmtRupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;

export function VehiclesTable({ vehicles }: { vehicles: Vehicle[] }) {
  const columns: DataColumn<Vehicle>[] = [
    {
      id: "plate",
      header: "Kendaraan",
      sortable: true,
      accessor: (v) => v.plate_number,
      cell: (v) => (
        <div>
          <div className="font-medium">{v.plate_number}</div>
          {v.model && <div className="text-muted-foreground text-xs">{v.model}</div>}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (v) =>
        v.active ? (
          <Badge className="bg-success/10 text-success">Aktif</Badge>
        ) : (
          <Badge variant="destructive">Nonaktif</Badge>
        ),
    },
    {
      id: "sopir",
      header: "Sopir",
      cell: (v) => v.sopir_name ?? <span className="text-muted-foreground text-xs">belum diisi</span>,
    },
    {
      id: "km",
      header: "KM",
      cell: (v) => (
        <div>
          <div>{v.current_km ?? "-"}</div>
          <div className="text-muted-foreground text-xs">
            servis terakhir: {v.last_service_km ?? "-"} km ({v.last_service_date ?? "-"})
          </div>
        </div>
      ),
    },
    {
      id: "bbm",
      header: "BBM Bulan Ini",
      cell: (v) =>
        v.bbm_liter_bulan_ini === 0 ? (
          <span className="text-muted-foreground text-xs">belum ada</span>
        ) : (
          <div>
            <div>{v.bbm_liter_bulan_ini.toLocaleString("id-ID")} L</div>
            <div className="text-muted-foreground text-xs">{fmtRupiah(v.bbm_cost_bulan_ini)}</div>
          </div>
        ),
    },
    {
      id: "service",
      header: "Service",
      cell: (v) =>
        v.service_due ? (
          <Badge variant="destructive">Due (interval {v.service_interval_km} km)</Badge>
        ) : (
          <Badge variant="outline">OK</Badge>
        ),
    },
    {
      id: "stnk",
      header: "STNK",
      cell: (v) =>
        !v.stnk_expiry ? (
          <span className="text-muted-foreground text-xs">belum diisi</span>
        ) : v.stnk_due ? (
          <Badge variant="destructive">
            {v.stnk_days_left != null && v.stnk_days_left < 0 ? "Sudah expired" : `H-${v.stnk_days_left}`} ({v.stnk_expiry})
          </Badge>
        ) : (
          <Badge variant="outline">{v.stnk_expiry}</Badge>
        ),
    },
    { id: "aksi", header: "Aksi", align: "right", cell: (v) => <VehicleRowActions vehicle={v} /> },
  ];

  return (
    <DataTable columns={columns} data={vehicles} getKey={(v) => v.id} searchPlaceholder="Cari plat / sopir…" pageSize={25} />
  );
}
