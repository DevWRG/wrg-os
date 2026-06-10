import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Note {
  id: string;
  am_id: string;
  period: string | null;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  score: number | null;
}

async function getNotes(): Promise<Note[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/coaching/notes`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { notes: Note[] }).notes;
  } catch {
    return null;
  }
}

const scoreVariant = (s: number | null): "default" | "secondary" | "destructive" =>
  s === null ? "secondary" : s >= 60 ? "default" : s < 30 ? "destructive" : "secondary";

export default async function CoachingPage() {
  const notes = await getNotes();

  return (
    <>
      <PageHeader
        title="Coaching Notes"
        description="Sintesis coaching per Account Manager hasil A11 — data live dari DB."
      />
      {!notes ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : notes.length === 0 ? (
        <p className="text-muted-foreground">Belum ada catatan. Jalankan agen A11.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {notes.map((n) => (
            <Card key={n.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {n.am_id}{" "}
                  <span className="text-muted-foreground text-xs font-normal">{n.period ?? ""}</span>
                </CardTitle>
                <Badge variant={scoreVariant(n.score)}>skor {n.score ?? "—"}</Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {n.strengths.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs">Kekuatan</p>
                    <div className="flex flex-wrap gap-1">
                      {n.strengths.map((s, i) => (
                        <Badge key={i} variant="outline">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {n.gaps.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs">Gap</p>
                    <div className="flex flex-wrap gap-1">
                      {n.gaps.map((g, i) => (
                        <Badge key={i} variant="destructive">
                          {g}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {n.recommendations.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs">Rekomendasi</p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {n.recommendations.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
