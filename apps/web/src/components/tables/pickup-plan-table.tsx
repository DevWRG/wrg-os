"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { PickupPlanRowActions } from "@/components/crm/pickup-plan-row-actions";

export interface PickupPlan {
  id: string;
  tanggal: string;
  customer_name: string;
  account_id: number | null;
  cabang: string | null;
  tujuan: string;
  sj_number: string | null;
  kurir_name: string | null;
  kurir_wa_number: string | null;
  status: string;
  catatan: string | null;
  previsit_notified_at: string | null;
  previsit_catatan: string | null;
  previsit_bermasalah: boolean;
}

// timeZone: "UTC" wajib — `new Date("2026-08-05")` itu tengah malam UTC, jadi
// tanpa ini nama HARI yang tampil bergeser untuk penonton di offset negatif dan
// bisa bertentangan dengan peringatan "akhir pekan" yang dihitung server.
const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", {
        weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
      });
};

// Ikut konvensi statusTone di shipments-table: Badge cuma punya variant
// default/secondary/destructive/outline (tak ada success/warning).
const statusTone = (s: string): "default" | "secondary" | "destructive" => {
  if (s === "batal") return "destructive";
  if (s === "selesai") return "secondary";
  return "default";
};

const columns: DataColumn<PickupPlan>[] = [
  {
    id: "tanggal",
    header: "Tanggal trip",
    sortable: true,
    accessor: (p) => p.tanggal,
    cell: (p) => <span className="font-medium whitespace-nowrap">{tgl(p.tanggal)}</span>,
  },
  {
    id: "customer",
    header: "Customer",
    sortable: true,
    accessor: (p) => p.customer_name,
    cell: (p) => (
      <div className="flex flex-col">
        <span>{p.customer_name}</span>
        {p.account_id == null && (
          <span className="text-muted-foreground text-xs">belum ditautkan ke akun — PIC tak dicek</span>
        )}
      </div>
    ),
  },
  { id: "tujuan", header: "Tujuan", sortable: true, accessor: (p) => p.tujuan },
  {
    id: "kurir",
    header: "Kurir",
    sortable: true,
    accessor: (p) => p.kurir_name ?? "",
    cell: (p) => (
      <div className="flex flex-col">
        <span>{p.kurir_name ?? "—"}</span>
        {!p.kurir_wa_number && <span className="text-muted-foreground text-xs">tanpa nomor WA</span>}
      </div>
    ),
  },
  { id: "sj", header: "No. SJ", accessor: (p) => p.sj_number ?? "", cell: (p) => p.sj_number ?? "—" },
  {
    id: "verifikasi",
    header: "Cek H-1",
    // 3 state, bukan 2. Kunci: "sudah diverifikasi" ≠ "kurir sudah diberi tahu".
    // Hasil cek disimpan untuk SEMUA plan yang jatuh tempo, tapi
    // previsit_notified_at hanya terisi kalau WA benar-benar terkirim — plan
    // tanpa nomor kurir (skipped no-target) atau yang gatewaynya gagal TIDAK
    // boleh tampil "aman", karena kurirnya tak pernah menerima apa pun.
    accessor: (p) => (!p.previsit_catatan ? 0 : !p.previsit_notified_at ? 1 : p.previsit_bermasalah ? 2 : 3),
    cell: (p) =>
      !p.previsit_catatan ? (
        <span className="text-muted-foreground text-xs">belum dicek</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {!p.previsit_notified_at ? (
            <Badge variant="destructive">belum terkirim</Badge>
          ) : (
            <Badge variant={p.previsit_bermasalah ? "destructive" : "secondary"}>
              {p.previsit_bermasalah ? "perlu perhatian" : "aman"}
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">
            {!p.previsit_notified_at ? `sudah dicek, WA belum terkirim — ${p.previsit_catatan}` : p.previsit_catatan}
          </span>
        </div>
      ),
  },
  {
    id: "status",
    header: "Status",
    sortable: true,
    accessor: (p) => p.status,
    cell: (p) => <Badge variant={statusTone(p.status)}>{p.status}</Badge>,
  },
  {
    id: "aksi",
    header: "Aksi",
    align: "right",
    cell: (p) => <PickupPlanRowActions id={p.id} customerName={p.customer_name} status={p.status} />,
  },
];

export function PickupPlanTable({ plans }: { plans: PickupPlan[] }) {
  return (
    <DataTable
      columns={columns}
      data={plans}
      getKey={(p) => p.id}
      searchPlaceholder="Cari customer / kurir / SJ…"
      pageSize={25}
    />
  );
}
