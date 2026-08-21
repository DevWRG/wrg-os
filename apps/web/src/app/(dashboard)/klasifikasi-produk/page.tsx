import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditKlasifikasi } from "@/lib/klasifikasi-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { KlasifikasiView } from "@/components/klasifikasi/klasifikasi-view";
import type {
  KlasifikasiSummary, ProductCode, ReviewRow, TaxonomyNode,
} from "@/components/klasifikasi/klasifikasi-view";

export const dynamic = "force-dynamic";

// Klasifikasi Produk — master taxonomy 4 level + penerbit kode KK.PP.CC.SSS.NNNN.
// Gate rute ditegakkan layout dashboard lewat katalog NAV (feature
// 'klasifikasi-produk'); di sini hanya penentuan hak TULIS yang diteruskan ke
// komponen supaya tombolnya tidak muncul untuk yang tidak berhak (penegakan
// sebenarnya tetap di BFF /api/klasifikasi/*).
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function KlasifikasiProdukPage() {
  const me = await sessionUser();
  const canEdit = canEditKlasifikasi(me);

  const [summary, taxonomy, codes, review] = await Promise.all([
    get<KlasifikasiSummary>("/klasifikasi/summary"),
    get<{ rows: TaxonomyNode[] }>("/klasifikasi/taxonomy"),
    get<{ rows: ProductCode[] }>("/klasifikasi/codes?limit=20000"),
    get<{ rows: ReviewRow[] }>("/klasifikasi/review?status=terbuka&limit=5000"),
  ]);

  return (
    <>
      <PageHeader
        title="Klasifikasi Produk"
        description="Master klasifikasi 4 level (Kategori → Product Line → Class → Sub Class) dan penerbit kode produk KK.PP.CC.SSS.NNNN. Kode dijamin unik & konsisten dengan hirarki master — kode lama dari spreadsheet tetap disimpan untuk rekonsiliasi Accurate."
      />
      <KlasifikasiView
        summary={summary}
        taxonomy={taxonomy?.rows ?? null}
        codes={codes?.rows ?? null}
        review={review?.rows ?? []}
        canEdit={canEdit}
      />
    </>
  );
}
