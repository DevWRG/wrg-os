import { apiBaseUrl } from "@/lib/gateway";
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

async function getTodos(): Promise<TodoItem[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/todos`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { todos: TodoItem[] }).todos;
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
        action={<AddTodoSheet />}
      />
      {!todos ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : todos.length === 0 ? (
        <p className="text-muted-foreground">Belum ada plan. Submit via <code>POST /todos</code>.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <TodosTable todos={todos} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
