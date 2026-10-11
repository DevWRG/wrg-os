import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BriefingsTabs } from "@/components/briefings/briefings-tabs";
import { SeninBriefView, type SeninBrief } from "@/components/briefings/senin-brief-view";

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
    const res = await gatewayFetch(`/briefings`);
    if (!res.ok) return null;
    return ((await res.json()) as { briefings: Briefing[] }).briefings;
  } catch {
    return null;
  }
}

// F85 — brief kesiapan 8 HoD tiap Senin (tabel senin_brief).
async function getSeninBriefs(): Promise<SeninBrief[] | null> {
  try {
    const res = await gatewayFetch(`/senin-brief`);
    if (!res.ok) return null;
    return ((await res.json()) as { briefs: SeninBrief[] }).briefs;
  } catch {
    return null;
  }
}

export default async function BriefingsPage() {
  const [briefings, seninBriefs] = await Promise.all([getBriefings(), getSeninBriefs()]);

  const a10 = !briefings ? (
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
    );

  return (
    <>
      <PageHeader
        title="Executive Briefings"
        description="Briefing eksekutif A10 & Senin Brief kesiapan 8 HoD sebelum rapat Direktur — data live dari DB."
      />
      <BriefingsTabs
        a10={a10}
        senin={
          seninBriefs ? (
            <SeninBriefView briefs={seninBriefs} />
          ) : (
            <p className="text-muted-foreground">Data Senin Brief tidak tersedia.</p>
          )
        }
      />
    </>
  );
}
