import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PameranView } from "@/components/pameran/pameran-view";

export const dynamic = "force-dynamic";

// F173 Pameran — registrasi pengunjung (form publik via QR) + kupon undian doorprize.
// Gerbang rute di layout + gerbang BFF per aksi. Tombol hanya tampil bila aksinya boleh.
export default async function PameranPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/pameran", "view")) {
    return (
      <>
        <PageHeader title="Pameran" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Pameran"
        description="Registrasi pengunjung pameran: pajang QR di booth, pengunjung mengisi nama, institusi, dan no. HP dari HP-nya sendiri lalu mendapat kupon undian doorprize. Data masuk ke sini — export, kocok pemenang, atau jadikan deal untuk prospek yang serius."
      />
      <PameranView
        izin={{
          buat: featureAllowed(me, "/pameran", "create"),
          ubah: featureAllowed(me, "/pameran", "edit"),
          hapus: featureAllowed(me, "/pameran", "delete"),
        }}
      />
    </>
  );
}
