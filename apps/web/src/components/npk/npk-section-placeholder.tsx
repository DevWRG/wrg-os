import { Clock } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder JUJUR untuk section mockup yang butuh data belum ada (AM Matrix / KPI
// Library non-sales / Trend ACE). Bukan angka palsu — jelaskan apa yang ditunggu.
export function NpkSectionPlaceholder({
  num, title, note, needs,
}: {
  num: number; title: string; note: string; needs: string[];
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between gap-2 border-b px-5 py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">{num}</span>
          {title}
        </CardTitle>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-700 uppercase dark:text-amber-400">
          <Clock className="size-3" /> Segera
        </span>
      </CardHeader>
      <CardContent className="px-5 py-5">
        <p className="text-sm text-muted-foreground">{note}</p>
        <div className="mt-3">
          <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Menunggu data / feed:</div>
          <ul className="mt-1.5 space-y-1">
            {needs.map((n) => (
              <li key={n} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                {n}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
