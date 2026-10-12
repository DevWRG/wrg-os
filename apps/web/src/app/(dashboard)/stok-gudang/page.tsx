import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  StockGudangView,
  type StockGudangInitial,
  type StockBranchSummary,
} from "@/components/inventory/stock-gudang-view";
import type { StockBranchRow, WarehouseCol } from "@/components/tables/stock-branch-table";

export const dynamic = "force-dynamic";

const LIMIT = 10000;

async function getStockGudang(): Promise<StockGudangInitial> {
  try {
    const [rowsRes, whRes, sumRes] = await Promise.all([
      gatewayFetch(`/stock/branch?limit=${LIMIT}`),
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

export default async function StokGudangPage() {
  const initial = await getStockGudang();
  return (
    <>
      <PageHeader
        title="Stok Gudang"
        description="Stok per gudang cabang beserta korelasinya ke angka total (mirror Accurate). Hanya gudang cabang WRG — gudang virtual di customer tidak ditampilkan."
      />
      <StockGudangView initial={initial} />
    </>
  );
}
