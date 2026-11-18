import { redirect } from "next/navigation";

// Simulator HD pindah jadi menu sendiri (/hd-simulator, 16 Nov 2026). Alamat lama dialihkan
// supaya tautan yang sudah tersimpan tetap jalan.
export default async function AlihSimulatorHd({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (typeof sp.proyek === "string" && /^\d{1,12}$/.test(sp.proyek)) q.set("proyek", sp.proyek);
  if (sp.tab === "margin") q.set("tab", "margin");
  redirect(`/hd-simulator${q.size ? `?${q}` : ""}`);
}
