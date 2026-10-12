import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { OrdersTable, type SalesOrder } from "@/components/tables/orders-table";
import { SummaryChart, type MirrorSummary } from "@/components/charts/summary-chart";

export const dynamic = "force-dynamic";

interface OrderListResponse {
  count: number;
  /** baris yang COCOK FILTER di backend — angka untuk footer tabel. */
  total_rows: number;
  limit: number;
  offset: number;
  rows: SalesOrder[];
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Kolom urut yang diterima backend (MIRROR_SORTS di apps/api repo/accurateMirror.ts).
const SORTS = ["trans_date", "number", "customer", "status", "total"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; sort?: string; dir?: string; page?: string; size?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : "";
  const sort = SORTS.includes(sp.sort ?? "") ? sp.sort! : "trans_date";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const size = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE;
  const page = Math.max(0, Math.trunc(Number(sp.page)) || 0);

  const listQs = new URLSearchParams();
  if (q) listQs.set("q", q);
  if (from) listQs.set("from", from);
  if (to) listQs.set("to", to);
  listQs.set("sort", sort);
  listQs.set("dir", dir);
  listQs.set("limit", String(size));
  listQs.set("offset", String(page * size));

  // Ringkasan dari endpoint agregat TERPISAH — bukan dihitung dari `rows`.
  // Yang paling berbahaya di menu ini: "Nilai total" (Rupiah) dulu dijumlahkan
  // dari 500 baris yang kebetulan ter-fetch, jadi angka uang yang ditampilkan
  // lebih kecil dari kenyataan tanpa memberi tanda apa pun.
  const [list, summary] = await Promise.all([
    getJson<OrderListResponse>(`/accurate/sales-orders?${listQs.toString()}`),
    getJson<MirrorSummary>("/accurate/sales-orders/summary"),
  ]);

  const matched = list?.total_rows ?? 0;

  // ?page= di luar jangkauan → ambil halaman terakhir yang valid.
  const lastPage = matched > 0 ? Math.ceil(matched / size) - 1 : 0;
  let pageAktif = page;
  let list2 = list;
  if (list && matched > 0 && list.rows.length === 0 && page > lastPage) {
    pageAktif = lastPage;
    listQs.set("offset", String(lastPage * size));
    list2 = (await getJson<OrderListResponse>(`/accurate/sales-orders?${listQs.toString()}`)) ?? list;
  }
  const orders = list2?.rows ?? null;

  return (
    <>
      <PageHeader title="Orders" description="Sales order terbaru dari Accurate (accurate_sales_order)." />
      {summary && summary.total > 0 ? <SummaryChart summary={summary} countLabel="Order" withAmount /> : null}
      <Card>
        <CardContent className="pt-6">
          {!orders ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : matched === 0 ? (
            <EmptyState
              title={q ? "Tidak ada order untuk pencarian ini" : "Belum ada order"}
              description={q ? "Ubah kata kuncinya." : "Jalankan sinkron: POST /accurate/sync/orders."}
            />
          ) : (
            <OrdersTable orders={orders} totalRows={matched} query={{ q, from, to, sort, dir, page: pageAktif, size }} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
