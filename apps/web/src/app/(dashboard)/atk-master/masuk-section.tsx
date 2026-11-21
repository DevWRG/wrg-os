import { gatewayFetch } from "@/lib/gateway";
import { EmptyState } from "@/components/ui/empty-state";
import { AtkStockInClient } from "@/components/atk/atk-stock-in-client";
import type { AtkStockMovementRow, AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
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

// Tab "Barang Masuk" di Kelola ATK (dulu seluruh /atk-stock-in) — izin key atk-stock-in.
export async function AtkMasukSection() {
  const [item, mov, lvl] = await Promise.all([
    getJson<{ rows: AtkItemApiRow[] }>("/atk/items"),
    getJson<{ rows: AtkStockMovementRow[] }>("/atk/stock-movements"),
    getJson<{ rows: AtkStockLevelRow[] }>("/atk/stock-levels"),
  ]);

  const itemOptions: AtkStockItemOption[] =
    item?.rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, is_active: r.is_active })) ?? [];

  return (
    <>
      {!item || !mov || !lvl ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem."
        />
      ) : (
        <AtkStockInClient movements={mov.rows ?? []} levels={lvl.rows ?? []} items={itemOptions} />
      )}
    </>
  );
}
