"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface Member {
  phone: string;
  nama: string | null;
  panggilan: string | null;
  posisi: string | null;
  cabang: string | null;
  wa_name: string | null;
  group_count: number;
  in_roster: boolean;
}

const columns: DataColumn<Member>[] = [
  {
    id: "nama",
    header: "Nama",
    sortable: true,
    accessor: (m) => m.nama ?? m.wa_name ?? m.phone,
    cell: (m) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{m.nama ?? m.wa_name ?? "—"}</div>
        {m.panggilan && <div className="text-muted-foreground text-xs">{m.panggilan}</div>}
      </div>
    ),
  },
  { id: "posisi", header: "Posisi", sortable: true, accessor: (m) => m.posisi ?? "", cell: (m) => <span className="text-muted-foreground">{m.posisi ?? "—"}</span> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (m) => m.cabang ?? "", cell: (m) => <span className="text-muted-foreground">{m.cabang ?? "—"}</span> },
  { id: "wa", header: "Nama WA", accessor: (m) => m.wa_name ?? "", cell: (m) => <span className="text-muted-foreground">{m.wa_name ?? "—"}</span> },
  { id: "grup", header: "Grup", align: "right", sortable: true, accessor: (m) => m.group_count, cell: (m) => <span className="tabular-nums">{m.group_count}</span> },
  {
    id: "roster",
    header: "Status",
    sortable: true,
    accessor: (m) => (m.in_roster ? 1 : 0),
    cell: (m) => (m.in_roster ? <Badge variant="secondary">Roster</Badge> : <Badge variant="outline">WA-only</Badge>),
  },
];

export function MonitorMembersTable({ members }: { members: Member[] }) {
  return (
    <DataTable
      columns={columns}
      data={members}
      getKey={(m) => m.phone}
      searchPlaceholder="Cari nama / posisi / cabang…"
      pageSize={25}
      empty="Belum ada member."
    />
  );
}
