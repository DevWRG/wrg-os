import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface TodoItem {
  id: string;
  am_id: string;
  am_name: string | null;
  tanggal: string;
  items: string[];
  total_items: number;
  is_late_plan: boolean;
  reported: boolean;
  reported_at: string | null;
  created_at: string;
}
interface TodoResponse {
  count: number;
  todos: TodoItem[];
}

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

async function getTodos(): Promise<TodoItem[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/todos`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as TodoResponse).todos;
  } catch {
    return null;
  }
}

export default async function TodosPage() {
  const todos = await getTodos();

  return (
    <>
      <PageHeader
        title="Sales TODO / Plan"
        description="Rencana harian AM (port sales_todo). Late plan = disubmit setelah jam 08:00 lokal."
      />

      {!todos ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : todos.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada plan. Submit via <code>POST /todos</code>.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>AM</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Item rencana</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todos.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.am_name ?? t.am_id}</TableCell>
                    <TableCell className="text-muted-foreground">{tanggal(t.tanggal)}</TableCell>
                    <TableCell className="max-w-md">
                      {t.items.length > 0 ? (
                        <ol className="list-decimal space-y-0.5 pl-4 text-sm">
                          {t.items.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ol>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{t.total_items}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {t.is_late_plan && <Badge variant="destructive">late plan</Badge>}
                        {t.reported ? (
                          <Badge variant="secondary">reported</Badge>
                        ) : (
                          <Badge variant="outline">belum report</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
