import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canPutusPermintaan } from "@/lib/permintaan-produk-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PermintaanView } from "@/components/permintaan-produk/permintaan-view";

export const dynamic = "force-dynamic";

// F171 Permintaan Produk Non-Master (Komite Product Development). Data dimuat di klien per tab;
// gerbang rute di layout + gerbang BFF per aksi. Tombol hanya tampil bila aksinya boleh.
export default async function PermintaanProdukPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/permintaan-produk", "view")) {
    return (
      <>
        <PageHeader title="Permintaan Produk" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Permintaan Produk"
        description="Permintaan lapangan untuk produk di luar master SKU: dicatat, dicek ke master (ada / bisa substitusi / belum ada), dikelompokkan, lalu kandidatnya dibawa ke review kuartal Komite Product Development untuk diputus Direksi."
      />
      <PermintaanView
        bolehCatat={featureAllowed(me, "/permintaan-produk", "create")}
        bolehUbah={featureAllowed(me, "/permintaan-produk", "edit")}
        bolehPutus={canPutusPermintaan(me)}
      />
    </>
  );
}
