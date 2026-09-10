import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ShipmentsTable, type DeliveryOrder } from "@/components/tables/shipments-table";
import { SummaryChart, type MirrorSummary } from "@/components/charts/summary-chart";

export const dynamic = "force-dynamic";

interface ShipmentListResponse {
  count: number;
  /** baris yang COCOK FILTER di backend — angka untuk footer tabel. */
  total_rows: number;
  limit: number;
  offset: number;
  rows: DeliveryOrder[];
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

export default async function ShipmentsPage({
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
  // Sebelumnya SummaryChart menerima 500 baris yang ter-fetch dan menjumlahkan
  // total/bulan-ini/customer-unik/grafik dari situ, padahal mirror-nya jauh
  // lebih besar dari 500.
  const [list, summary] = await Promise.all([
    getJson<ShipmentListResponse>(`/accurate/shipments?${listQs.toString()}`),
    getJson<MirrorSummary>("/accurate/shipments/summary"),
  ]);

  const matched = list?.total_rows ?? 0;

  // ?page= di luar jangkauan → ambil halaman terakhir yang valid.
  const lastPage = matched > 0 ? Math.ceil(matched / size) - 1 : 0;
  let pageAktif = page;
  let list2 = list;
  if (list && matched > 0 && list.rows.length === 0 && page > lastPage) {
    pageAktif = lastPage;
    listQs.set("offset", String(lastPage * size));
    list2 = (await getJson<ShipmentListResponse>(`/accurate/shipments?${listQs.toString()}`)) ?? list;
  }
  const shipments = list2?.rows ?? null;

  return (
    <>
      <PageHeader title="Shipments" description="Surat jalan / pengiriman terbaru dari Accurate (accurate_delivery_order)." />
      {summary && summary.total > 0 ? <SummaryChart summary={summary} countLabel="Pengiriman" /> : null}
      <Card>
        <CardContent className="pt-6">
          {!shipments ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : matched === 0 ? (
            <EmptyState
              title={q ? "Tidak ada pengiriman untuk pencarian ini" : "Belum ada pengiriman"}
              description={q ? "Ubah kata kuncinya." : "Jalankan sinkron: POST /accurate/sync/shipments."}
            />
          ) : (
            <ShipmentsTable
              shipments={shipments}
              totalRows={matched}
              query={{ q, from, to, sort, dir, page: pageAktif, size }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
