"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Toolbar filter rentang tanggal (Dari/Sampai) + preset "Bulan ini" & Reset.
// Dipakai di slot `toolbar` DataTable (mis. Manage Leave, Visits, Sales TODO).
export function DateRangeToolbar({
  from,
  to,
  onFrom,
  onTo,
  idPrefix = "dr",
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  idPrefix?: string;
}) {
  const thisMonth = () => {
    const n = new Date();
    onFrom(ymd(new Date(n.getFullYear(), n.getMonth(), 1)));
    onTo(ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`${idPrefix}-from`} className="text-muted-foreground text-xs">Dari</Label>
      <Input id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="bg-card h-8 w-auto" />
      <Label htmlFor={`${idPrefix}-to`} className="text-muted-foreground text-xs">Sampai</Label>
      <Input id={`${idPrefix}-to`} type="date" value={to} onChange={(e) => onTo(e.target.value)} className="bg-card h-8 w-auto" />
      <Button variant="outline" size="sm" onClick={thisMonth}>Bulan ini</Button>
      {(from || to) && (
        <Button variant="ghost" size="sm" onClick={() => { onFrom(""); onTo(""); }}>Reset</Button>
      )}
    </div>
  );
}
