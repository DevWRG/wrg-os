import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AtkStockOpnameClient } from "@/components/atk/atk-stock-opname-client";
import type { AtkStockOpnameRow } from "@/components/atk/atk-stock-opname-table";
import type { AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
import type { AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

export const dynamic = "force-dynamic";

interface AtkItemApiRow {
  id: string;
  name: string;
  unit: string;
  is_active: boolean;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function AtkStockOpnamePage() {
  const [item, opname, lvl] = await Promise.all([
    getJson<{ rows: AtkItemApiRow[] }>("/atk/items"),
    getJson<{ rows: AtkStockOpnameRow[] }>("/atk/stock-opname"),
    getJson<{ rows: AtkStockLevelRow[] }>("/atk/stock-levels"),
  ]);

  const itemOptions: AtkStockItemOption[] =
    item?.rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, is_active: r.is_active })) ?? [];

  return (
    <>
      <PageHeader
        title="ATK Stock Opname"
        description="Hitung fisik barang ATK dibanding stok sistem (F136) — selisih disesuaikan lewat form Stock In/Out yang sama, hanya beda submenu."
      />
      {!item || !opname || !lvl ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Pastikan apps/api jalan dengan DATABASE_URL dan migrasi 070_atk_stock_opname.sql sudah diterapkan."
        />
      ) : (
        <AtkStockOpnameClient opnames={opname.rows ?? []} levels={lvl.rows ?? []} items={itemOptions} />
      )}
    </>
  );
}
