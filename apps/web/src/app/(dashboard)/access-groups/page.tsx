import { PageHeader } from "@/components/dashboard/page-header";
import { AccessGroupManager } from "@/components/access/access-group-manager";

export const dynamic = "force-dynamic";

export default function AccessGroupsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Akses Grup"
        description="Kelola grup akses (role) — anggota + hak akses per-fitur (Aktif/Buat/Ubah/Hapus/Lihat)."
      />
      <AccessGroupManager />
    </div>
  );
}
