import { Badge } from "@/components/ui/badge";
import { TeknisiCardActions } from "@/components/crm/teknisi-card-actions";

export interface TeknisiReadiness {
  id: string;
  nama: string;
  wa_number?: string | null;
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
          <div key={t.id} className={`flex items-center justify-between rounded-lg border p-3 ${t.aktif ? "" : "opacity-50"}`}>
            <div>
              <div className="font-medium">
                {t.nama}
                {!t.aktif && <span className="text-muted-foreground ml-1.5 text-xs">(nonaktif)</span>}
              </div>
              <div className="text-muted-foreground text-xs">
                {t.capacity_used} / {t.max_concurrent_jobs} job aktif
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={full ? "destructive" : t.capacity_used === 0 ? "outline" : "secondary"}>
                {full ? "Penuh" : `${t.capacity_available} slot`}
              </Badge>
              <TeknisiCardActions teknisi={t} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
