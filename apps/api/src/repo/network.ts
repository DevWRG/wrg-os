import { db } from "../db.js";

// D1b — analisis jaringan relasi (A9 Spider Network). Membangun graf co-occurrence
// dari anotasi A8 (message_annotation): node = entity + pengirim, edge = muncul
// bersama dalam satu pesan. Pure & deterministik — dipakai run (ter-audit) dan
// endpoint GET (live, tanpa audit).

export interface NetworkInputRow {
  sender_name: string | null;
  entities: { type: string; value: string }[];
}

export async function getNetworkInput(
  windowDays = 30,
  limit = 2000,
): Promise<NetworkInputRow[]> {
  const sql = db();
  const rows = await sql`
    SELECT sender_name, entities
    FROM message_annotation
    WHERE created_at >= now() - (${windowDays} || ' days')::interval
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    sender_name: r.sender_name ? String(r.sender_name) : null,
    entities: Array.isArray(r.entities) ? (r.entities as { type: string; value: string }[]) : [],
  }));
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
  frequency: number;
}
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}
export interface NetworkGraph {
  summary: {
    nodes: number;
    edges: number;
    components: number;
    density: number;
    by_type: Record<string, number>;
  };
  top_nodes: GraphNode[];
  top_edges: GraphEdge[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Union-find untuk hitung komponen terhubung.
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    // path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  components(ids: string[]): number {
    const roots = new Set(ids.map((i) => this.find(i)));
    return roots.size;
  }
}

export function computeNetwork(rows: NetworkInputRow[]): NetworkGraph {
  const nodeType = new Map<string, string>();
  const nodeLabel = new Map<string, string>();
  const freq = new Map<string, number>(); // pesan tempat node muncul
  const adj = new Map<string, Set<string>>();
  const edgeWeight = new Map<string, number>();
  const uf = new UnionFind();

  const addNode = (id: string, type: string, label: string) => {
    if (!nodeType.has(id)) {
      nodeType.set(id, type);
      nodeLabel.set(id, label);
      adj.set(id, new Set());
    }
    freq.set(id, (freq.get(id) ?? 0) + 1);
  };

  for (const row of rows) {
    const parts: { id: string; type: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const e of row.entities) {
      if (!e.value) continue;
      const id = `${e.type}:${e.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      parts.push({ id, type: e.type, label: e.value });
    }
    if (row.sender_name) {
      const id = `person:${row.sender_name}`;
      if (!seen.has(id)) {
        seen.add(id);
        parts.push({ id, type: "person", label: row.sender_name });
      }
    }
    for (const p of parts) addNode(p.id, p.type, p.label);
    // edge untuk tiap pasangan dalam pesan ini
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const [a, b] = [parts[i].id, parts[j].id].sort();
        const key = `${a}||${b}`;
        edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
        uf.union(a, b);
      }
    }
  }

  const nodes: GraphNode[] = [...nodeType.keys()].map((id) => ({
    id,
    type: nodeType.get(id) as string,
    label: nodeLabel.get(id) as string,
    degree: adj.get(id)?.size ?? 0,
    frequency: freq.get(id) ?? 0,
  }));
  const edges: GraphEdge[] = [...edgeWeight.entries()].map(([key, weight]) => {
    const [source, target] = key.split("||");
    return { source, target, weight };
  });

  const byType: Record<string, number> = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const n = nodes.length;
  const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 1;
  const summary = {
    nodes: n,
    edges: edges.length,
    components: n ? uf.components(nodes.map((x) => x.id)) : 0,
    density: Math.round((edges.length / maxEdges) * 1000) / 1000,
    by_type: byType,
  };

  const top_nodes = [...nodes]
    .sort((a, b) => b.degree - a.degree || b.frequency - a.frequency)
    .slice(0, 20);
  const top_edges = [...edges].sort((a, b) => b.weight - a.weight).slice(0, 20);

  return { summary, top_nodes, top_edges, nodes, edges };
}
