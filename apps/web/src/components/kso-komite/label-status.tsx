import { cn } from "@/lib/utils";

import { STATUS_LABEL, statusCls } from "./types";

/** Label status rencana KSO: titik + teks, warna per kelompok (menunggu/jalan/penawaran/berhenti). */
export function LabelStatus({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", statusCls(status))}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />{STATUS_LABEL[status] ?? status}
    </span>
  );
}
