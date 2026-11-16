import { PageHeader } from "@/components/dashboard/page-header";
import { PetaLayanan } from "@/components/status-job/peta-layanan";
import { StatusJobBoard } from "@/components/status-job/status-job-board";

export const dynamic = "force-dynamic";

export default function StatusJobPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Status Job"
        description="Layanan dan job terjadwal di server: proses mana yang hidup, kapan job terakhir jalan, berhasil atau gagal, dan apakah ada jadwal yang terlewat."
      />
      <PetaLayanan />
      <StatusJobBoard />
    </div>
  );
}
