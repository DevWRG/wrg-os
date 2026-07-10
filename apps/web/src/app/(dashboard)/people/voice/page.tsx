import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { VoiceOfEmployee, type VoiceItem } from "@/components/people/voice-of-employee";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// F128 Voice of Employee (tab Kendala & Usulan) — agregat kendala (pain) + ide/usulan lintas karyawan.
export default async function VoicePage() {
  const data = await get<{ items: VoiceItem[] }>("/employee-spine/voice");
  return (
    <>
      <PageHeader
        title="Voice of Employee"
        description="Agregat kendala & ide/usulan lintas karyawan — filter per departemen & kata kunci. (F128)"
      />
      <VoiceOfEmployee items={data?.items ?? []} />
    </>
  );
}
