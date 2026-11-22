import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  StockGudangView,
  type StockGudangInitial,
  type StockBranchSummary,
} from "@/components/inventory/stock-gudang-view";
import type { StockBranchRow, StockQuery, WarehouseCol } from "@/components/tables/stock-branch-table";

export const dynamic = "force-dynamic";

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;
const FILTER: StockQuery["filter"][] = ["anomali", "tanpa_data"];

// Satu halaman saja (mode server). Dulu limit=10000 = seluruh katalog ke browser.
async function getStockGudang(q: StockQuery): Promise<StockGudangInitial> {
  const qs = new URLSearchParams();
  if (q.q) qs.set("q", q.q);
  if (q.filter === "anomali") qs.set("negatif", "1");
  if (q.filter === "tanpa_data") qs.set("tanpa_data", "1");
  qs.set("sort", q.sort);
  qs.set("dir", q.dir);
  qs.set("limit", String(q.size));
  qs.set("offset", String(q.page * q.size));
  try {
    const [rowsRes, whRes, sumRes] = await Promise.all([
      gatewayFetch(`/stock/branch?${qs.toString()}`),
      gatewayFetch(`/stock/warehouses?aktif=1`),
      gatewayFetch(`/stock/branch/summary`),
    ]);
    if (!rowsRes.ok) {
      return { rows: [], total_rows: 0, warehouses: [], summary: null, warehousesGagal: true, error: "gagal memuat stok per gudang" };
    }
    const rowsJson = (await rowsRes.json()) as { rows: StockBranchRow[]; total_rows: number };
    // Kegagalan warehouses TIDAK ditelan jadi array kosong: tanpa kolom gudang,
    // Σ Cabang & Selisih tetap tampil dan halaman kelihatan lengkap padahal
    // matriksnya hilang. Ditandai supaya bisa diberitahukan.
    let warehouses: WarehouseCol[] = [];
    let warehousesGagal = true;
    if (whRes.ok) {
      warehouses = ((await whRes.json()) as { warehouses: WarehouseCol[] }).warehouses ?? [];
      warehousesGagal = false;
    }
    const summary = sumRes.ok ? ((await sumRes.json()) as StockBranchSummary) : null;
    return {
      rows: rowsJson.rows ?? [],
      total_rows: rowsJson.total_rows ?? 0,
      warehouses,
      summary,
      warehousesGagal,
      error: null,
    };
  } catch (e) {
    return {
      rows: [],
      total_rows: 0,
      warehouses: [],
      summary: null,
      warehousesGagal: true,
      error: String(e instanceof Error ? e.message : e),
    };
  }
}

export default async function StokGudangPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; sort?: string; dir?: string; page?: string; size?: string }>;
}) {
  const sp = await searchParams;
  const query: StockQuery = {
    q: (sp.q ?? "").trim(),
    filter: FILTER.includes(sp.filter as StockQuery["filter"]) ? (sp.filter as StockQuery["filter"]) : "semua",
    // id kolom urut divalidasi ulang di apps/api (isStockSort); di sini cukup pola.
    sort: /^(no|name|total|jumlah_cabang|selisih|wh-[A-Za-z0-9_.-]{1,30})$/.test(sp.sort ?? "") ? sp.sort! : "no",
    dir: sp.dir === "desc" ? "desc" : "asc",
    size: PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : DEFAULT_SIZE,
    page: Math.max(0, Math.trunc(Number(sp.page)) || 0),
  };
  const initial = await getStockGudang(query);
  return (
    <>
      <PageHeader
        title="Stok Gudang"
        description="Stok per gudang cabang beserta korelasinya ke angka total (mirror Accurate). Hanya gudang cabang WRG — gudang virtual di customer tidak ditampilkan."
      />
      <StockGudangView initial={initial} query={query} />
    </>
  );
}
