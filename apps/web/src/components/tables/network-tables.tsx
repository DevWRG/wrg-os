"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
  frequency: number;
}
interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const labelOf = (id: string) => id.split(":").slice(1).join(":") || id;

const nodeColumns: DataColumn<GraphNode>[] = [
  { id: "label", header: "Entity", sortable: true, accessor: (n) => n.label, cell: (n) => <span className="font-medium">{n.label}</span> },
  { id: "type", header: "Tipe", sortable: true, accessor: (n) => n.type, cell: (n) => <Badge variant="secondary">{n.type}</Badge> },
  { id: "degree", header: "Degree", align: "right", sortable: true, accessor: (n) => n.degree },
  { id: "freq", header: "Freq", align: "right", sortable: true, accessor: (n) => n.frequency },
];

export function NetworkNodesTable({ nodes }: { nodes: GraphNode[] }) {
  return <DataTable columns={nodeColumns} data={nodes} getKey={(n) => n.id} searchPlaceholder="Cari entity…" pageSize={10} />;
}

const edgeColumns: DataColumn<GraphEdge>[] = [
  {
    id: "relasi",
    header: "Relasi",
    sortable: true,
    accessor: (e) => `${labelOf(e.source)} ${labelOf(e.target)}`,
    cell: (e) => (
      <span>
        {labelOf(e.source)} <span className="text-muted-foreground">↔</span> {labelOf(e.target)}
      </span>
    ),
  },
  { id: "weight", header: "Bobot", align: "right", sortable: true, accessor: (e) => e.weight },
];

export function NetworkEdgesTable({ edges }: { edges: GraphEdge[] }) {
  return <DataTable columns={edgeColumns} data={edges} getKey={(e, i) => `${e.source}-${e.target}-${i}`} searchPlaceholder="Cari relasi…" pageSize={10} />;
}
