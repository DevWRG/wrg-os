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

/** 303: faskes SEMENTARA (calon customer) dari #KSO — belum tertaut ke akun master. Warna/10 + teks (bukan bg-muted). */
export function BadgeFaskesBaru({ kota, className }: { kota?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-violet-700 dark:text-violet-300", className)}
      title="Faskes baru (calon customer) — belum ada di master Accurate/CRM; Sekretariat menautkannya begitu akunnya ada">
      Faskes baru{kota ? ` · ${kota}` : ""}
    </span>
  );
}
