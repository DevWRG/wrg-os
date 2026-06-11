import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NetworkNodesTable, NetworkEdgesTable } from "@/components/tables/network-tables";

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
    const res = await gatewayFetch(`/network/graph`);
    if (!res.ok) return null;
    return (await res.json()) as Graph;
  } catch {
    return null;
  }
}

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
                <NetworkNodesTable nodes={g.top_nodes} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pasangan Terkuat</CardTitle>
              </CardHeader>
              <CardContent>
                <NetworkEdgesTable edges={g.top_edges} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
