import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Analytics {
  summary: {
    team_size: number;
    avg_score: number | null;
    min_score: number | null;
    max_score: number | null;
    distribution: { high: number; mid: number; low: number };
  };
  top_performers: { am_id: string; score: number }[];
  needs_attention: { am_id: string; score: number; gaps: string[] }[];
  common_gaps: { gap: string; count: number }[];
}

async function getAnalytics(): Promise<Analytics | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/people/analytics`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Analytics;
  } catch {
    return null;
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function PeoplePage() {
  const a = await getAnalytics();

  return (
    <>
      <PageHeader
        title="People Analytics"
        description="Rollup SDM tingkat-organisasi hasil A12 (dari coaching A11) — data live dari DB."
      />
      {!a ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : a.summary.team_size === 0 ? (
        <p className="text-muted-foreground">Belum ada data. Jalankan A11 lalu A12.</p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tim (AM)" value={a.summary.team_size} />
            <Stat label="Skor rata-rata" value={a.summary.avg_score ?? "—"} />
            <Stat label="Min / Max" value={`${a.summary.min_score ?? "—"} / ${a.summary.max_score ?? "—"}`} />
            <Stat
              label="Distribusi (H/M/L)"
              value={`${a.summary.distribution.high}/${a.summary.distribution.mid}/${a.summary.distribution.low}`}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Performers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {a.top_performers.length === 0 ? (
                  <p className="text-muted-foreground">—</p>
                ) : (
                  a.top_performers.map((p) => (
                    <div key={p.am_id} className="flex items-center justify-between">
                      <span>{p.am_id}</span>
                      <Badge>{p.score}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Perlu Perhatian</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {a.needs_attention.length === 0 ? (
                  <p className="text-muted-foreground">Tidak ada. 🎉</p>
                ) : (
                  a.needs_attention.map((p) => (
                    <div key={p.am_id}>
                      <div className="flex items-center justify-between">
                        <span>{p.am_id}</span>
                        <Badge variant="destructive">{p.score}</Badge>
                      </div>
                      {p.gaps.length > 0 && (
                        <p className="text-muted-foreground text-xs">{p.gaps.join(" · ")}</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Gap Paling Umum</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              {a.common_gaps.length === 0 ? (
                <p className="text-muted-foreground">—</p>
              ) : (
                a.common_gaps.map((g) => (
                  <Badge key={g.gap} variant="outline">
                    {g.gap} · {g.count}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
