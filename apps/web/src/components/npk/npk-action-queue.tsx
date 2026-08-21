import { AlertTriangle, TrendingUp, Zap } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmt1, type NpkMatrixRow } from "./npk-format";
import { zoneOf } from "./npk-status";

interface ActionItem {
  key: string; name: string; role: string; npk: number;
  zoneLabel: string; border: string; icon: typeof Zap;
  desc: string; owner: string; action: string;
  order: number;
}

// Item aksi HANYA dari zona final (pip/watch/promote). Subjek dgn coverage parsial
// masuk zona "provisional" → tak pernah jadi item, supaya tak ada rekomendasi PIP/
// promosi yang lahir dari data yang belum lengkap (lihat catatan di npk-status.ts).
function buildItems(rows: NpkMatrixRow[]): ActionItem[] {
  const items: ActionItem[] = [];
  for (const r of rows) {
    const z = zoneOf(r);
    if (z.key === "pip") {
      items.push({
        key: r.subject_key, name: r.subject_name, role: r.role, npk: r.npk, zoneLabel: "Tindak Lanjut",
        border: z.border, icon: AlertTriangle, order: 0,
        desc: `${r.role}. NPK sementara ${fmt1(r.npk)} di bawah ambang — coaching intensif & rencana perbaikan.`,
        owner: "Direktur + HoD atasan", action: "1-on-1 review · rencana perbaikan",
      });
    } else if (z.key === "watch") {
      items.push({
        key: r.subject_key, name: r.subject_name, role: r.role, npk: r.npk, zoneLabel: "Perlu Perhatian",
        border: z.border, icon: AlertTriangle, order: 1,
        desc: `${r.role}. NPK ${fmt1(r.npk)} mendekati ambang — perhatian & coaching berkala.`,
        owner: "HoD atasan", action: "Coaching berkala",
      });
    } else if (z.key === "promote") {
      items.push({
        key: r.subject_key, name: r.subject_name, role: r.role, npk: r.npk, zoneLabel: "Kandidat Promosi",
        border: z.border, icon: TrendingUp, order: 2,
        desc: `${r.role}. Predikat sangat baik (NPK ${fmt1(r.npk)}) — review kandidat promosi/jenjang karir (SK Pasal 2.2).`,
        owner: "Direktur", action: "Review promosi",
      });
    }
  }
  return items.sort((a, b) => a.order - b.order || a.npk - b.npk);
}

export function NpkActionQueue({ rows }: { rows: NpkMatrixRow[] }) {
  const items = buildItems(rows);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex-row items-center justify-between gap-2 rounded-t-2xl border-b bg-teal-500/8 px-5 py-3">
        <div className="flex items-center gap-2 font-semibold text-teal-800 dark:text-teal-300">
          <Zap className="size-4" /> Coaching &amp; Promotion Action Queue
        </div>
        <span className="text-xs text-muted-foreground">{items.length} item</span>
      </CardHeader>
      <CardContent className="px-0">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Belum ada aksi — coaching/promosi baru direkomendasikan setelah ke-7 aspek SK punya data.
            Selama coverage masih parsial, skor rendah tidak diartikan sebagai kinerja buruk.
          </div>
        ) : (
          <ul>
            {items.map((it) => (
              <li key={it.key} className="flex gap-3 border-b px-5 py-3.5 last:border-0">
                <div className={cn("w-1 shrink-0 rounded-full", it.border)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <it.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold">{it.name}</span>
                    <span className="text-sm text-muted-foreground">· NPK {fmt1(it.npk)}</span>
                    <span className="text-xs font-medium text-muted-foreground">— {it.zoneLabel}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{it.desc}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Owner: <span className="font-medium text-foreground">{it.owner}</span></span>
                    <span className="text-muted-foreground/60">→ {it.action}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
