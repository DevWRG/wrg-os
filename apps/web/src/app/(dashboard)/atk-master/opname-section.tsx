import { gatewayFetch } from "@/lib/gateway";
import { EmptyState } from "@/components/ui/empty-state";
import { AtkStockOpnameClient } from "@/components/atk/atk-stock-opname-client";
import type { AtkStockOpnameRow } from "@/components/atk/atk-stock-opname-table";
import type { AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
import type { AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

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

// Tab "Stock Opname" di Kelola ATK (dulu seluruh /atk-stock-opname) — izin key atk-stock-opname.
export async function AtkOpnameSection() {
  const [item, opname, lvl] = await Promise.all([
    getJson<{ rows: AtkItemApiRow[] }>("/atk/items"),
    getJson<{ rows: AtkStockOpnameRow[] }>("/atk/stock-opname"),
    getJson<{ rows: AtkStockLevelRow[] }>("/atk/stock-levels"),
  ]);

  const itemOptions: AtkStockItemOption[] =
    item?.rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, is_active: r.is_active })) ?? [];

  return (
    <>
      {!item || !opname || !lvl ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem."
        />
      ) : (
        <AtkStockOpnameClient opnames={opname.rows ?? []} levels={lvl.rows ?? []} items={itemOptions} />
      )}
    </>
  );
}
