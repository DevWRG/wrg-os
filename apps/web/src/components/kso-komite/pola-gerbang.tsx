// Tujuh kotak gerbang berwarna (pola_gerbang "hhmhh…" dari kso.v_rencana). Dipisah dari komite-view supaya bisa dipakai
// tab lain (riwayat-forum) tanpa impor melingkar.
import { cn } from "@/lib/utils";

import { GERBANG_SOLID, POLA_STATUS } from "./types";

export function PolaGerbang({ pola }: { pola: string | null }) {
  if (!pola) return null;
  return (
    <span className="inline-flex gap-0.5" aria-label={`gerbang ${pola}`}>
      {pola.split("").map((c, i) => (
        <span key={i} className={cn("inline-block size-4 rounded-[3px] text-center text-[10px] font-bold leading-4", GERBANG_SOLID[POLA_STATUS[c] ?? "belum"])}>{i + 1}</span>
      ))}
    </span>
  );
}
