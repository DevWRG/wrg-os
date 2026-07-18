import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PREDIKAT_LABEL, type Predikat } from "./npk-format";

const CLS: Record<Predikat, string> = {
  sangat_baik: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  baik: "bg-teal-500/12 text-teal-700 dark:text-teal-400",
  cukup: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  kurang: "bg-orange-500/12 text-orange-700 dark:text-orange-400",
  buruk: "bg-red-500/12 text-red-700 dark:text-red-400",
};

export function PredikatBadge({ predikat, className }: { predikat: Predikat; className?: string }) {
  return (
    <Badge variant="ghost" className={cn("font-semibold", CLS[predikat], className)}>
      {PREDIKAT_LABEL[predikat]}
    </Badge>
  );
}
