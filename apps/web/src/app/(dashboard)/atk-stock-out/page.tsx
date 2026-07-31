import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AtkStockOutClient } from "@/components/atk/atk-stock-out-client";
import type { AtkStockMovementRow, AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
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

export default async function AtkStockOutPage() {
  const [item, mov, lvl] = await Promise.all([
    getJson<{ rows: AtkItemApiRow[] }>("/atk/items"),
    getJson<{ rows: AtkStockMovementRow[] }>("/atk/stock-movements"),
    getJson<{ rows: AtkStockLevelRow[] }>("/atk/stock-levels"),
  ]);

  const itemOptions: AtkStockItemOption[] =
    item?.rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, is_active: r.is_active })) ?? [];

  return (
    <>
      <PageHeader
        title="ATK Stock Out"
        description="Ambil/pakai barang ATK & Materai — bisa dicatat tim mana pun (F49, termasuk kategori transaksi Materai F54), bukan cuma General Affairs. Cek ketersediaan dulu di tab Cek Stok."
      />
      {!item || !mov || !lvl ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Pastikan apps/api jalan dengan DATABASE_URL dan migrasi 069_atk_stock_movement.sql + 071_atk_transaction_category.sql sudah diterapkan."
        />
      ) : (
        <AtkStockOutClient
          movements={(mov.rows ?? []).filter((m) => m.movement_type === "out")}
          levels={lvl.rows ?? []}
          items={itemOptions}
        />
      )}
    </>
  );
}
