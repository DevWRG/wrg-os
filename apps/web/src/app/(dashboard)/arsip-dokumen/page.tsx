import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canAturBukuArsip } from "@/lib/arsip-dokumen-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ArsipView } from "@/components/arsip-dokumen/arsip-view";

export const dynamic = "force-dynamic";

// F156 Arsip Dokumen Digital Terpusat. Data dimuat di klien; gerbang rute di layout +
// gerbang BFF per aksi. Tombol hanya tampil bila aksinya boleh.
export default async function ArsipDokumenPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/arsip-dokumen", "view")) {
    return (
      <>
        <PageHeader title="Arsip Dokumen" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Arsip Dokumen"
        description="Satu tempat untuk scan dokumen semua divisi — bukti transaksi, SJ, berita acara, tanda terima, faktur pembelian, sertifikat, surat. Nomor otomatis BUKU/TAHUN/BULAN/URUT; telusur by nomor, faktur, SJ, PO, serial number, atau bulan."
      />
      <ArsipView
        bolehUnggah={featureAllowed(me, "/arsip-dokumen", "create")}
        bolehUbah={featureAllowed(me, "/arsip-dokumen", "edit")}
        bolehHapus={featureAllowed(me, "/arsip-dokumen", "delete")}
        bolehAturBuku={canAturBukuArsip(me)}
      />
    </>
  );
}
