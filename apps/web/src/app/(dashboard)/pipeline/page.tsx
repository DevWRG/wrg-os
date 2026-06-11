import { gatewayFetch } from "@/lib/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

interface Deal {
  deal_id: string;
  customer_name: string;
  am_id: string;
  estimated_value: number | null;
}
interface Stage {
  stage: string;
  count: number;
  total_value: number;
  deals: Deal[];
}
interface Pipeline {
  stages: Stage[];
  total_deals: number;
  total_value: number;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

async function getPipeline(): Promise<Pipeline | null> {
  try {
    const res = await gatewayFetch(`/pipeline`);
    if (!res.ok) return null;
    return (await res.json()) as Pipeline;
  } catch {
    return null;
  }
}

export default async function PipelinePage() {
  const data = await getPipeline();

  if (!data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Deal Pipeline</h1>
        <p className="text-muted-foreground mt-2">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan{" "}
          <code>DATABASE_URL</code> (mis. <code>wrg_os_dev</code>).
        </p>
      </div>
    );
  }

  const active = data.stages.filter((s) => s.count > 0);
  const shown = active.length ? active : data.stages;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Deal Pipeline</h1>
        <p className="text-muted-foreground">
          {data.total_deals} deal · {rupiah(data.total_value)} total estimasi (data live dari DB)
        </p>
      </div>

      {data.total_deals === 0 ? (
        <p className="text-muted-foreground">
          Belum ada deal. Kirim <code>#PLAN</code> via <code>/api/plan</code> untuk membuat pipeline.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((s) => (
            <Card key={s.stage}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{s.stage}</CardTitle>
                <Badge variant="secondary">{s.count}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {s.total_value > 0 && (
                  <p className="text-xs text-muted-foreground">{rupiah(s.total_value)}</p>
                )}
                {s.deals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  s.deals.map((d) => (
                    <div
                      key={d.deal_id}
                      className="flex items-center justify-between border-b pb-1 text-sm last:border-0"
                    >
                      <span className="truncate">{d.customer_name}</span>
                      <span className="text-muted-foreground shrink-0 pl-2">
                        {d.estimated_value ? rupiah(d.estimated_value) : "—"}
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
