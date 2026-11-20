import { gatewayFetch } from "@/lib/gateway";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Note {
  id: string;
  am_id: string;
  am_name: string | null;
  period: string | null;
  strengths: string[];
  gaps: string[];
  recommendations: string[];
  score: number | null;
}

async function getNotes(): Promise<Note[] | null> {
  try {
    const res = await gatewayFetch(`/coaching/notes`);
    if (!res.ok) return null;
    return ((await res.json()) as { notes: Note[] }).notes;
  } catch {
    return null;
  }
}

const scoreVariant = (s: number | null): "default" | "secondary" | "destructive" =>
  s === null ? "secondary" : s >= 60 ? "default" : s < 30 ? "destructive" : "secondary";

// Tab "Catatan Coaching" di Raport Karyawan 360 (K18, dulu seluruh /coaching).
// Izin tetap key `coaching`; datanya diambil hanya saat tab ini aktif.
export async function CoachingSection() {
  const notes = await getNotes();

  return (
    <>
      {!notes ? (
        <p className="text-muted-foreground">Catatan coaching gagal dimuat. Coba muat ulang halaman.</p>
      ) : notes.length === 0 ? (
        <p className="text-muted-foreground">Belum ada catatan coaching. Catatan dibuat otomatis oleh agen coaching (A11).</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {notes.map((n) => (
            <Card key={n.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">
                  {n.am_name ?? `AM ${n.am_id}`}{" "}
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
