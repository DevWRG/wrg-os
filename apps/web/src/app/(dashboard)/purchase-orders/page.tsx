import { AlertTriangle, ClipboardList, PackageCheck } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AddPurchaseOrderSheet } from "@/components/crm/add-purchase-order-sheet";
import { PurchaseOrderTable, type PurchaseOrderRow } from "@/components/tables/purchase-order-table";

export const dynamic = "force-dynamic";

interface PurchaseOrderListResponse {
  /** baris yang dikirim di halaman ini. */
  count: number;
  /** baris yang COCOK FILTER di backend — angka untuk footer tabel. */
  total_rows: number;
  limit: number;
  offset: number;
  rows: PurchaseOrderRow[];
}

interface PurchaseOrderSummary {
  total: number;
  by_status: Record<string, number>;
  telat: number;
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

// Kolom urut yang diterima backend (PO_SORTS di apps/api repo/purchase-order.ts).
const SORTS = ["order_date", "po_number", "vendor_name", "cabang", "eta_date", "status"];
const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    dir?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "";
  const sort = SORTS.includes(sp.sort ?? "") ? sp.sort! : "order_date";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const size = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE;
  const page = Math.max(0, Math.trunc(Number(sp.page)) || 0);

  const listQs = new URLSearchParams();
  if (q) listQs.set("q", q);
  if (status) listQs.set("status", status);
  listQs.set("sort", sort);
  listQs.set("dir", dir);
  listQs.set("limit", String(size));
  listQs.set("offset", String(page * size));

  // Kartu KPI datang dari endpoint agregat TERPISAH, bukan dari `rows`.
  // Sebelumnya ketiganya dihitung dengan rows.filter() atas array ?limit=1000
  // yang sama dengan tabel — begitu PO lewat 1000, kartunya ikut salah tanpa
  // memberi tanda apa pun.
  const [list, summary] = await Promise.all([
    getJson<PurchaseOrderListResponse>(`/purchase-orders?${listQs.toString()}`),
    getJson<PurchaseOrderSummary>("/purchase-orders/summary"),
  ]);

  const matched = list?.total_rows ?? 0;

  // ?page= di luar jangkauan → ambil halaman terakhir yang valid. Tanpa ini
  // tabelnya kosong tapi footernya tetap menulis jumlah penuh — tampilan yang
  // sejenis dengan bug yang sedang diperbaiki. Permintaan kedua ini hanya
  // terjadi pada kasus di luar jangkauan, bukan pemakaian normal.
  const lastPage = matched > 0 ? Math.ceil(matched / size) - 1 : 0;
  let pageAktif = page;
  let list2 = list;
  if (list && matched > 0 && list.rows.length === 0 && page > lastPage) {
    pageAktif = lastPage;
    listQs.set("offset", String(lastPage * size));
    list2 = (await getJson<PurchaseOrderListResponse>(`/purchase-orders?${listQs.toString()}`)) ?? list;
  }
  const rows = list2?.rows ?? null;
  const berjalan = (summary?.by_status?.ordered ?? 0) + (summary?.by_status?.partial_received ?? 0);
  const telat = summary?.telat ?? 0;
  const received = summary?.by_status?.received ?? 0;

  return (
    <>
      <PageHeader
        title="PO Tracker & Barang Masuk"
        description="Lacak PO ke vendor sampai barang diterima (F13) — status & riwayat penerimaan dihitung otomatis dari log barang masuk."
        action={<AddPurchaseOrderSheet />}
      />
      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="PO berjalan" value={String(berjalan)} icon={ClipboardList} />
          <StatCard title="PO telat" value={String(telat)} deltaTone={telat > 0 ? "negative" : "neutral"} delta={telat > 0 ? "ETA sudah lewat, belum diterima penuh" : undefined} icon={AlertTriangle} />
          <StatCard title="PO diterima penuh" value={String(received)} icon={PackageCheck} />
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & DATABASE_URL terhubung." />
          ) : matched === 0 ? (
            <EmptyState
              title={q || status ? "Tidak ada PO untuk filter ini" : "Belum ada PO"}
              description={q || status ? "Ubah kata kunci atau filter status." : "Tambah lewat tombol Tambah PO di atas."}
            />
          ) : (
            <PurchaseOrderTable
              rows={rows}
              totalRows={matched}
              query={{ q, status, sort, dir, page: pageAktif, size }}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
