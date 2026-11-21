import { gatewayFetch } from "@/lib/gateway";
import { EmptyState } from "@/components/ui/empty-state";
import { AtkMasterClient } from "@/components/atk/atk-master-client";
import type { AtkCategoryRow } from "@/components/atk/atk-category-table";
import type { AtkSupplierRow } from "@/components/atk/atk-supplier-table";
import type { AtkItemRow } from "@/components/atk/atk-item-table";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// Tab "Master" di Kelola ATK (dulu seluruh /atk-master).
export async function AtkMasterSection() {
  const [cat, sup, item] = await Promise.all([
    getJson<{ rows: AtkCategoryRow[] }>("/atk/categories"),
    getJson<{ rows: AtkSupplierRow[] }>("/atk/suppliers"),
    getJson<{ rows: AtkItemRow[] }>("/atk/items"),
  ]);

  return (
    <>
      {!cat || !sup || !item ? (
        <EmptyState
          title="Data tidak tersedia"
          description="Muat ulang halaman; kalau tetap kosong, laporkan ke admin sistem."
        />
      ) : (
        <AtkMasterClient categories={cat.rows ?? []} suppliers={sup.rows ?? []} items={item.rows ?? []} />
      )}
    </>
  );
}
