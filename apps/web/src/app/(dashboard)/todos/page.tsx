import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddTodoSheet } from "@/components/crm/add-todo-sheet";
import { TodosTable } from "@/components/tables/todos-table";
import { Card, CardContent } from "@/components/ui/card";

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
}

interface TodoPage {
  total_rows: number;
  todos: TodoItem[];
}

// Kolom urut yang diterima backend (TODO_SORTS di apps/api repo/todo.ts).
const SORTS = ["tanggal", "am", "total"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;
const tglOk = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v! : "");

async function getTodos(qs: URLSearchParams): Promise<TodoPage | null> {
  try {
    const res = await gatewayFetch(`/todos/list?${qs.toString()}`);
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<TodoPage>;
    return { total_rows: Number(d.total_rows ?? 0), todos: d.todos ?? [] };
  } catch {
    return null;
  }
}

// Mode server: dulu halaman ini memanggil /todos polos — backend memotong di
// 1.000 plan terbaru (prod 22 Nov: 4.300 plan, yang tampil hanya sejak ±9 Okt)
// dan filter tanggal di klien kosong untuk rentang lama.
export default async function TodosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; sort?: string; dir?: string; page?: string; size?: string }>;
}) {
  const sp = await searchParams;
  const query = {
    q: (sp.q ?? "").trim(),
    from: tglOk(sp.from),
    to: tglOk(sp.to),
    sort: SORTS.includes(sp.sort ?? "") ? sp.sort! : "tanggal",
    dir: (sp.dir === "asc" ? "asc" : "desc") as "asc" | "desc",
    size: PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE,
    page: Math.max(0, Math.trunc(Number(sp.page)) || 0),
  };
  const qs = new URLSearchParams();
  if (query.q) qs.set("q", query.q);
  if (query.from) qs.set("from", query.from);
  if (query.to) qs.set("to", query.to);
  qs.set("sort", query.sort);
  qs.set("dir", query.dir);
  qs.set("limit", String(query.size));
  qs.set("offset", String(query.page * query.size));
  const data = await getTodos(qs);
  const adaFilter = !!(query.q || query.from || query.to);

  return (
    <>
      <PageHeader
        title="Plan Operasional"
        description="Rencana harian tim non-AM (gudang, ops, admin) dari WhatsApp. Late plan = dikirim setelah batas jam pagi."
        action={<AddTodoSheet />}
      />
      {!data ? (
        <p className="text-muted-foreground">
          Data belum bisa dimuat. Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem.
        </p>
      ) : data.total_rows === 0 && !adaFilter ? (
        <p className="text-muted-foreground">Belum ada plan. Plan masuk lewat WhatsApp atau tombol tambah di kanan atas.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <TodosTable todos={data.todos} totalRows={data.total_rows} query={query} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
