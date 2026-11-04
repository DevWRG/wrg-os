import { PageHeader } from "@/components/dashboard/page-header";
import { StatusJobBoard } from "@/components/status-job/status-job-board";

export const dynamic = "force-dynamic";

export default function StatusJobPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Status Job"
        description="Job terjadwal di server: kapan terakhir jalan, berhasil atau gagal, dan apakah ada jadwal yang terlewat."
      />
      <StatusJobBoard />
    </div>
  );
}
