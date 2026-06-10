import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

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
interface Graph {
  summary: {
    nodes: number;
    edges: number;
    components: number;
    density: number;
    by_type: Record<string, number>;
  };
  top_nodes: GraphNode[];
  top_edges: GraphEdge[];
}

async function getGraph(): Promise<Graph | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/network/graph`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Graph;
  } catch {
    return null;
  }
}

const labelOf = (id: string) => id.split(":").slice(1).join(":") || id;

export default async function NetworkPage() {
  const g = await getGraph();

  return (
    <>
      <PageHeader
        title="Spider Network"
        description="Graf relasi entity↔pengirim hasil A9 (dari anotasi A8) — data live dari DB."
      />
      {!g ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : g.summary.nodes === 0 ? (
        <p className="text-muted-foreground">Graf kosong. Jalankan A8 (anotasi) lalu A9.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{g.summary.nodes} node</Badge>
            <Badge variant="outline">{g.summary.edges} edge</Badge>
            <Badge variant="outline">{g.summary.components} komponen</Badge>
            <Badge variant="outline">density {g.summary.density}</Badge>
            {Object.entries(g.summary.by_type).map(([t, n]) => (
              <Badge key={t} variant="secondary">
                {t}: {n}
              </Badge>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Node Tersentral</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead className="text-right">Degree</TableHead>
                      <TableHead className="text-right">Freq</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.top_nodes.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-medium">{n.label}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{n.type}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{n.degree}</TableCell>
                        <TableCell className="text-right">{n.frequency}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pasangan Terkuat</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Relasi</TableHead>
                      <TableHead className="text-right">Bobot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.top_edges.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {labelOf(e.source)} <span className="text-muted-foreground">↔</span>{" "}
                          {labelOf(e.target)}
                        </TableCell>
                        <TableCell className="text-right">{e.weight}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
