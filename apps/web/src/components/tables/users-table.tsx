"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { UserRowActions } from "@/components/crm/user-row-actions";

interface User {
  am_id: string;
  nama: string;
  panggilan: string | null;
  wa_number: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  area: string | null;
  aktif: boolean;
  wajib_plan_report: boolean;
}

const columns: DataColumn<User>[] = [
  { id: "panggilan", header: "Panggilan", sortable: true, accessor: (u) => u.panggilan ?? u.am_id, cell: (u) => <span className="font-medium">{u.panggilan ?? u.am_id}</span> },
  { id: "nama", header: "Nama", sortable: true, accessor: (u) => u.nama, cell: (u) => <span className="text-muted-foreground">{u.nama}</span> },
  { id: "role", header: "Role", sortable: true, accessor: (u) => u.role, cell: (u) => <Badge variant="outline">{u.role}</Badge> },
  { id: "posisi", header: "Posisi", sortable: true, accessor: (u) => u.posisi ?? "", cell: (u) => <span className="text-muted-foreground">{u.posisi ?? "—"}</span> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (u) => u.cabang ?? "", cell: (u) => <span className="text-muted-foreground">{u.cabang ?? "—"}</span> },
  { id: "wa", header: "WA", accessor: (u) => u.wa_number ?? "", cell: (u) => <span className="text-muted-foreground">{u.wa_number ?? "—"}</span> },
  {
    id: "status",
    header: "Status",
    sortable: true,
    accessor: (u) => (u.aktif ? 1 : 0),
    cell: (u) => (
      <div className="flex gap-1">
        {u.aktif ? <Badge variant="secondary">aktif</Badge> : <Badge variant="outline">nonaktif</Badge>}
        {u.wajib_plan_report && <Badge variant="outline">wajib report</Badge>}
      </div>
    ),
  },
  { id: "aksi", header: "Aksi", align: "right", cell: (u) => <UserRowActions user={u} /> },
];

export function UsersTable({ users }: { users: User[] }) {
  return <DataTable columns={columns} data={users} getKey={(u) => u.am_id} searchPlaceholder="Cari nama / cabang / role…" pageSize={25} />;
}
