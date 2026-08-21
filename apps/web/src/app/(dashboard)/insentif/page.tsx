import { PageHeader } from "@/components/dashboard/page-header";
import { InsentifSaya } from "@/components/insentif-saya";

export const dynamic = "force-dynamic";

// Insentif Saya — SELF-ONLY untuk semua peran, termasuk Direktur (PRD §E.3).
// Identitas datang dari sesi lewat BFF (x-user-id) → backend /insentif/self; halaman
// ini tak pernah menerima am_id dari query string. Menu tim ada di /insentif/tim.
export default function InsentifPage() {
  return (
    <>
      <PageHeader
        title="Insentif Saya"
        description="Rincian insentif Anda per bulan, dihitung per transaksi lunas. Hanya menampilkan data Anda sendiri."
      />
      <InsentifSaya />
    </>
  );
}
