"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

// Form target penjualan East/West per tahun × periode (Year/Quarter/Month).
// Simpan → PUT /api/sales/targets. Dipakai kartu Sales Performance.

const PERIODS = [
  { key: "year", label: "Tahunan (YTD)" },
  { key: "quarter", label: "Kuartalan" },
  { key: "month", label: "Bulanan" },
] as const;
const REGIONS = ["East", "West"] as const;

type Key = `${(typeof PERIODS)[number]["key"]}-${(typeof REGIONS)[number]}`;
interface TargetRow {
  period: string;
  region: string;
  target: number;
}

const nowYear = new Date().getFullYear();
const rp = (n: number) => new Intl.NumberFormat("id-ID").format(n);

export function SalesTargetForm() {
  const [year, setYear] = useState(nowYear);
  const [vals, setVals] = useState<Record<Key, string>>({} as Record<Key, string>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets?year=${y}`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: TargetRow[] };
      const next = {} as Record<Key, string>;
      for (const r of data.rows ?? []) next[`${r.period}-${r.region}` as Key] = String(r.target ?? "");
      setVals(next);
    } catch {
      setError("Gagal memuat target.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // setState terjadi di dalam loader async (setelah await); load stabil (useCallback).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(year);
  }, [year, load]);

  const set = (k: Key, v: string) => {
    setVals((p) => ({ ...p, [k]: v.replace(/[^\d]/g, "") }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const entries = PERIODS.flatMap((p) =>
        REGIONS.map((r) => ({ period: p.key, region: r, target: Number(vals[`${p.key}-${r}` as Key] || 0) })),
      );
      const res = await fetch("/api/sales/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, entries }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setSaved(true);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  const totalOf = (region: (typeof REGIONS)[number]) =>
    PERIODS.reduce((a, p) => a + Number(vals[`${p.key}-${region}` as Key] || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="target-year" className="text-muted-foreground text-xs">Tahun</Label>
          <Input
            id="target-year"
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value) || nowYear)}
            className="bg-card h-8 w-28"
          />
          {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-4 font-medium">Periode</th>
                <th className="px-2 py-2 font-medium">Target East (Rp)</th>
                <th className="px-2 py-2 font-medium">Target West (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((p) => (
                <tr key={p.key} className="border-t">
                  <td className="py-2 pr-4 font-medium">{p.label}</td>
                  {REGIONS.map((r) => (
                    <td key={r} className="px-2 py-2">
                      <Input
                        inputMode="numeric"
                        value={vals[`${p.key}-${r}` as Key] ?? ""}
                        onChange={(e) => set(`${p.key}-${r}` as Key, e.target.value)}
                        placeholder="0"
                        className="bg-card h-8 w-full text-right tabular-nums"
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t">
                <td className="text-muted-foreground py-2 pr-4 text-xs">Total (E+W per periode dihitung di kartu)</td>
                <td className="text-muted-foreground px-2 py-2 text-right text-xs tabular-nums">Σ {rp(totalOf("East"))}</td>
                <td className="text-muted-foreground px-2 py-2 text-right text-xs tabular-nums">Σ {rp(totalOf("West"))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
            {saved ? "Tersimpan" : "Simpan target"}
          </Button>
          <span className="text-muted-foreground text-xs">Nilai dalam Rupiah penuh (mis. 125000000000).</span>
        </div>
      </CardContent>
    </Card>
  );
}
