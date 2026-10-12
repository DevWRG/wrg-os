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
  status: string;
  bukti_photo_path: string | null;
  signature_photo_path: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  dikirim: "Dikirim",
  terima: "Terima",
  bast: "BAST (Selesai)",
};

const STATUS_ORDER = ["draft", "dikirim", "terima", "bast"];

const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "bast" ? "secondary" : s === "draft" ? "outline" : "default";

function ProgressDots({ s }: { s: ShipmentTracking }) {
  const idx = STATUS_ORDER.indexOf(s.status);
  const steps = [idx >= 1, idx >= 2, idx >= 3];
  return (
    <div className="flex items-center gap-1" title="Dikirim → Terima → BAST">
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
      id: "analitik",
      header: "Jarak & Durasi (aktual)",
      cell: (s) =>
        s.distance_km != null ? (
          <div>
            <div>{s.distance_km} km</div>
            <div className="text-muted-foreground text-xs">{s.eta_days ?? "?"} hari kirim→BAST</div>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">
            {s.status === "bast" ? "foto tanpa geotag" : "dihitung setelah BAST"}
          </span>
        ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (s) => s.status,
      cell: (s) => <Badge variant={statusTone(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Badge>,
    },
    {
      id: "bukti",
      header: "Bukti (F93)",
      cell: (s) =>
        s.status !== "bast" ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <div className="flex items-center gap-1 text-xs">
            <span title="Foto bukti terima">{s.bukti_photo_path ? "📷✅" : "📷—"}</span>
            <span title="Scan tanda tangan">{s.signature_photo_path ? "✍️✅" : "✍️—"}</span>
          </div>
        ),
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
