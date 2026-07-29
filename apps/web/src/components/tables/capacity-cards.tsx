import { Badge } from "@/components/ui/badge";

export interface TeknisiReadiness {
  id: string;
  nama: string;
  max_concurrent_jobs: number;
  capacity_used: number;
  capacity_available: number;
  aktif: boolean;
}

export function CapacityCards({ board }: { board: TeknisiReadiness[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {board.map((t) => {
        const full = t.capacity_available <= 0;
        return (
          <div key={t.id} className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">{t.nama}</div>
              <div className="text-muted-foreground text-xs">
                {t.capacity_used} / {t.max_concurrent_jobs} job aktif
              </div>
            </div>
            <Badge variant={full ? "destructive" : t.capacity_used === 0 ? "outline" : "secondary"}>
              {full ? "Penuh" : `${t.capacity_available} slot`}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
