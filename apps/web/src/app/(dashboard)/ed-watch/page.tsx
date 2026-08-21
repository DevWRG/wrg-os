import { PageHeader } from "@/components/dashboard/page-header";
import { EdWatchPanel } from "@/components/inventory/ed-watch-panel";

// Halaman berdiri sendiri (route /ed-watch, domain Purchasing) — sebelumnya
// tab ketiga di /inventory, dipisah jadi route sendiri atas arahan Direktur
// (domain grouping, sama perlakuan spt Stok Gudang/F37). EdWatchPanel sudah
// self-contained (fetch sendiri saat mount, tak butuh data server-side) sejak
// awal, jadi dipindah apa adanya tanpa perlu di-refactor jadi server component.
export default function EdWatchPage() {
  return (
    <>
      <PageHeader
        title="ED & Kedaluwarsa"
        description="Pemantauan batch mendekati/lewat tanggal kedaluwarsa (ambang 90/60/30 hari) beserta saran alokasi."
      />
      <EdWatchPanel />
    </>
  );
}
