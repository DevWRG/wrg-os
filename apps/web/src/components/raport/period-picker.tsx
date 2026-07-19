"use client";

// Selektor periode raport: Tahun + Periode (Tahunan / Semester / Kuartal).
// period string: "YYYY" (tahunan) · "YYYY-H1|H2" (semester) · "YYYY-Q1..Q4" (kuartal).

const SEGMENTS: { v: string; label: string }[] = [
  { v: "FY", label: "Tahunan" },
  { v: "H1", label: "Semester 1" },
  { v: "H2", label: "Semester 2" },
  { v: "Q1", label: "Kuartal 1" },
  { v: "Q2", label: "Kuartal 2" },
  { v: "Q3", label: "Kuartal 3" },
  { v: "Q4", label: "Kuartal 4" },
];

const wibYear = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear();

function parse(period: string): { year: number; seg: string } {
  let m = period.match(/^(\d{4})-Q([1-4])$/i);
  if (m) return { year: +m[1], seg: `Q${m[2]}` };
  m = period.match(/^(\d{4})-H([1-2])$/i);
  if (m) return { year: +m[1], seg: `H${m[2]}` };
  m = period.match(/^(\d{4})$/);
  if (m) return { year: +m[1], seg: "FY" };
  return { year: wibYear(), seg: "FY" };
}

const buildPeriod = (year: number, seg: string): string => (seg === "FY" ? `${year}` : `${year}-${seg}`);

// Default = kuartal berjalan (selaras backend).
export function defaultPeriod(): string {
  const w = new Date(Date.now() + 7 * 3600 * 1000);
  return `${w.getUTCFullYear()}-Q${Math.ceil((w.getUTCMonth() + 1) / 3)}`;
}

export function PeriodPicker({ period, onChange }: { period: string; onChange: (p: string) => void }) {
  const { year, seg } = parse(period);
  const nowY = wibYear();
  const years = [nowY, nowY - 1, nowY - 2, nowY - 3];
  const cls = "border-input bg-card h-8 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary";
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">Periode</span>
      <select value={seg} onChange={(e) => onChange(buildPeriod(year, e.target.value))} className={cls}>
        {SEGMENTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
      <select value={year} onChange={(e) => onChange(buildPeriod(+e.target.value, seg))} className={cls}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
