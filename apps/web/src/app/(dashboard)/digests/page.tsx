import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Rekap {
  id: string;
  group_jid: string;
  group_name: string | null;
  period_start: string;
  period_end: string;
  model_used: string | null;
  raw_output: string;
  created_at: string;
}
interface Resume {
  id: string;
  period_date: string;
  period_type: string;
  model_used: string | null;
  raw_output: string;
  created_at: string;
}
interface History {
  rekaps: Rekap[];
  resumes: Resume[];
}

const dt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

async function getHistory(): Promise<History | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/digests`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as History;
  } catch {
    return null;
  }
}

function Output({ text }: { text: string }) {
  return (
    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
      {text || "(kosong)"}
    </pre>
  );
}

export default async function DigestsPage() {
  const data = await getHistory();

  return (
    <>
      <PageHeader
        title="Digest History"
        description="Rekap & resume eksekutif monitor yang tersimpan — data live dari DB."
      />

      {!data ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan{" "}
          <code>DATABASE_URL</code>.
        </p>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Resume Eksekutif{" "}
              <span className="text-muted-foreground text-sm font-normal">
                ({data.resumes.length})
              </span>
            </h2>
            {data.resumes.length === 0 ? (
              <p className="text-muted-foreground text-sm">Belum ada resume tersimpan.</p>
            ) : (
              data.resumes.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-base">
                      {r.period_date}{" "}
                      <Badge variant="outline" className="ml-1">
                        {r.period_type}
                      </Badge>
                    </CardTitle>
                    <span className="text-muted-foreground text-xs">
                      {r.model_used ?? "—"} · {dt(r.created_at)}
                    </span>
                  </CardHeader>
                  <CardContent>
                    <Output text={r.raw_output} />
                  </CardContent>
                </Card>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Rekap{" "}
              <span className="text-muted-foreground text-sm font-normal">
                ({data.rekaps.length})
              </span>
            </h2>
            {data.rekaps.length === 0 ? (
              <p className="text-muted-foreground text-sm">Belum ada rekap tersimpan.</p>
            ) : (
              data.rekaps.map((r) => (
                <Card key={r.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-base">
                      {r.group_name ?? r.group_jid}
                    </CardTitle>
                    <span className="text-muted-foreground text-xs">
                      {r.model_used ?? "—"} · {dt(r.created_at)}
                    </span>
                  </CardHeader>
                  <CardContent>
                    <Output text={r.raw_output} />
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        </div>
      )}
    </>
  );
}
