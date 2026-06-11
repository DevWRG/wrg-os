"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface DigestEntry {
  waktu: string | null;
  content: string;
}
interface DigestData {
  dates: string[];
  date: string | null;
  entries: DigestEntry[];
}

const prettyDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return y && m && day ? `${day} ${MON[m - 1]} ${y}` : d;
};

export function DigestView({ kind, initial }: { kind: "rekap" | "resume"; initial: DigestData }) {
  const [data, setData] = useState<DigestData>(initial);
  const [date, setDate] = useState<string>(initial.date ?? "");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (d: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/monitor/${kind}?date=${d}`, { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    if (date && date !== data.date) void load(date);
  }, [date, data.date, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="digest-date" className="text-muted-foreground text-xs">Tanggal</label>
        <select
          id="digest-date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border-input bg-card h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
        >
          {data.dates.map((d) => (
            <option key={d} value={d}>{prettyDate(d)}</option>
          ))}
        </select>
        {loading && <span className="text-muted-foreground text-xs">memuat…</span>}
      </div>

      {data.entries.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState title={`Tidak ada ${kind}`} description="Tak ada data untuk tanggal ini." />
          </CardContent>
        </Card>
      ) : (
        data.entries.map((e, i) => (
          <Card key={`${e.waktu}-${i}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {kind === "rekap" ? "Rekap" : "Resume"} {e.waktu ? `· ${e.waktu} WIB` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-foreground/90 font-sans text-sm whitespace-pre-wrap">{e.content}</pre>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
