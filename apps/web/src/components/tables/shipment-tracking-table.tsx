"use client";

import { CheckCircle2, Circle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ShipmentTrackingRowActions } from "@/components/crm/shipment-tracking-row-actions";

export interface ShipmentTracking {
  id: string;
  sj_number: string;
  customer_name: string;
  cabang: string | null;
  distance_km: number | null;
  eta_days: number | null;
  eta_date: string | null;
  status: string;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  dikirim: "Dikirim",
  bast: "BAST (Selesai)",
};

const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "bast" ? "secondary" : s === "draft" ? "outline" : "default";

function ProgressDots({ s }: { s: ShipmentTracking }) {
  const steps = [s.status !== "draft", s.status === "bast"];
  return (
    <div className="flex items-center gap-1" title="Dikirim → BAST">
      {steps.map((done, i) =>
        done ? (
          <CheckCircle2 key={i} className="text-success size-4" />
        ) : (
          <Circle key={i} className="text-muted-foreground/40 size-4" />
        ),
      )}
    </div>
  );
}

export function ShipmentTrackingTable({ shipments }: { shipments: ShipmentTracking[] }) {
  const columns: DataColumn<ShipmentTracking>[] = [
    {
      id: "sj",
      header: "No. SJ",
      sortable: true,
      accessor: (s) => s.sj_number,
      cell: (s) => (
        <div>
          <div className="font-medium">{s.sj_number}</div>
          {s.cabang && <div className="text-muted-foreground text-xs">dari {s.cabang}</div>}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Customer",
      sortable: true,
      accessor: (s) => s.customer_name,
      cell: (s) => <div>{s.customer_name}</div>,
    },
    {
      id: "eta",
      header: "ETA",
      cell: (s) =>
        s.eta_date ? (
          <div>
            <div>{s.eta_date}</div>
            <div className="text-muted-foreground text-xs">
              {s.distance_km ?? "?"} km · {s.eta_days ?? "?"} hari
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">jarak belum diisi</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (s) => s.status,
      cell: (s) => <Badge variant={statusTone(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge>,
    },
    { id: "progress", header: "Progress", cell: (s) => <ProgressDots s={s} /> },
    { id: "aksi", header: "Aksi", align: "right", cell: (s) => <ShipmentTrackingRowActions row={s} /> },
  ];

  return (
    <DataTable
      columns={columns}
      data={shipments}
      getKey={(s) => s.id}
      searchPlaceholder="Cari No. SJ / customer…"
      pageSize={25}
    />
  );
}
