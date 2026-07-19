import { redirect } from "next/navigation";

// Drilldown lama → hub "Karyawan 360".
export default async function RaportKaryawanDetailRedirect({ params }: { params: Promise<{ amId: string }> }) {
  const { amId } = await params;
  redirect(`/karyawan/${encodeURIComponent(amId)}`);
}
