import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { MonitorMembersTable } from "@/components/tables/monitor-members-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Member {
  phone: string;
  nama: string | null;
  panggilan: string | null;
  posisi: string | null;
  cabang: string | null;
  wa_name: string | null;
  group_count: number;
  in_roster: boolean;
}

async function getMembers(): Promise<Member[]> {
  try {
    const res = await gatewayFetch(`/monitor/members`);
    if (!res.ok) return [];
    const data = (await res.json()) as { members: Member[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

export default async function MonitorMembersPage() {
  const members = await getMembers();
  const roster = members.filter((m) => m.in_roster).length;

  return (
    <>
      <PageHeader
        title="Members"
        description={`Direktori member WhatsApp + roster organisasi (port wrg-monitor). ${members.length} member · ${roster} di roster.`}
      />
      <Card>
        <CardContent className="pt-6">
          <MonitorMembersTable members={members} />
        </CardContent>
      </Card>
    </>
  );
}
