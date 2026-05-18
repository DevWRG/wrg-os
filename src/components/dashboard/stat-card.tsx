import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
}

export function StatCard({
  title,
  value,
  delta,
  deltaTone = "neutral",
  icon: Icon,
}: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {title}
        </CardTitle>
        <Icon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {delta ? (
          <p
            className={cn(
              "text-muted-foreground mt-1 text-xs",
              deltaTone === "positive" && "text-emerald-600 dark:text-emerald-500",
              deltaTone === "negative" && "text-destructive",
            )}
          >
            {delta}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
