import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Briefing {
  id: string;
  week_start: string;
  raw_output: string;
  model_used: string | null;
  hitl_status: string;
  created_at: string;
}

async function getBriefings(): Promise<Briefing[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/briefings`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { briefings: Briefing[] }).briefings;
  } catch {
    return null;
  }
}

export default async function BriefingsPage() {
  const briefings = await getBriefings();

  return (
    <>
      <PageHeader
        title="Executive Briefings"
        description="Briefing eksekutif lintas-domain hasil A10 — data live dari DB."
      />
      {!briefings ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : briefings.length === 0 ? (
        <p className="text-muted-foreground">Belum ada briefing. Jalankan agen A10.</p>
      ) : (
        <div className="space-y-4">
          {briefings.map((b) => (
            <Card key={b.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Minggu {b.week_start}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={b.hitl_status === "pending" ? "secondary" : "outline"}>
                    {b.hitl_status}
                  </Badge>
                  <span className="text-muted-foreground text-xs">{b.model_used ?? "—"}</span>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted/50 max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                  {b.raw_output || "(kosong)"}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
