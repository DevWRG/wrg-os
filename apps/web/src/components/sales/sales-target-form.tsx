"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";

// Target penjualan per tahun: (1) region East/West × periode, (2) per cabang
// (tahunan), (3) per AM (tahunan). Region cabang/AM diturunkan dari Territory.

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

function RegionPill({ region }: { region: string }) {
  const cls =
    region === "East"
      ? "bg-primary/10 text-primary"
      : region === "West"
        ? "bg-success-soft text-success"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{region}</span>;
}

function SaveButton({ saving, saved, disabled, onClick, label = "Simpan target" }: { saving: boolean; saved: boolean; disabled?: boolean; onClick: () => void; label?: string }) {
  return (
    <Button size="sm" onClick={onClick} disabled={saving || disabled}>
      {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
      {saved ? "Tersimpan" : label}
    </Button>
  );
}

// ── Section 1: Target region East/West × periode ──
function RegionTargets({ year }: { year: number }) {
  const [vals, setVals] = useState<Record<Key, string>>({} as Record<Key, string>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets?year=${y}`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: TargetRow[] };
      const next = {} as Record<Key, string>;
      for (const r of data.rows ?? []) next[`${r.period}-${r.region}` as Key] = String(r.target ?? "");
      setVals(next);
    } catch { setError("Gagal memuat target region."); } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(year); }, [year, load]);

  const set = (k: Key, raw: string) => { setVals((p) => ({ ...p, [k]: raw })); setSaved(false); };

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const entries = PERIODS.flatMap((p) => REGIONS.map((r) => ({ period: p.key, region: r, target: Number(vals[`${p.key}-${r}` as Key] || 0) })));
      const res = await fetch("/api/sales/targets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, entries }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setSaved(true);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setSaving(false); }
  }

  const totalOf = (region: (typeof REGIONS)[number]) => PERIODS.reduce((a, p) => a + Number(vals[`${p.key}-${region}` as Key] || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Target Region (East / West)</h3>
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
                      <CurrencyInput value={vals[`${p.key}-${r}` as Key] ?? ""} onChange={(raw) => set(`${p.key}-${r}` as Key, raw)} placeholder="0" className="bg-card h-8 w-full" />
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
          <SaveButton saving={saving} saved={saved} disabled={loading} onClick={save} />
          <span className="text-muted-foreground text-xs">Nilai dalam Rupiah penuh (mis. 125000000000).</span>
        </div>
      </CardContent>
    </Card>
  );
}

interface CabangRow { cabang: string; region: string; target: number }
interface AmRow { am_id: string; nama: string; cabang: string | null; region: string; target: number }

// ── Section 2: Target per Cabang (tahunan) ──
function CabangTargets({ year }: { year: number }) {
  const [rows, setRows] = useState<CabangRow[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets/cabang?year=${y}`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: CabangRow[] };
      setRows(data.rows ?? []);
      setVals(Object.fromEntries((data.rows ?? []).map((r) => [r.cabang, r.target ? String(r.target) : ""])));
    } catch { setError("Gagal memuat target cabang."); } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(year); }, [year, load]);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const entries = rows.map((r) => ({ cabang: r.cabang, target: Number(vals[r.cabang] || 0) }));
      const res = await fetch("/api/sales/targets/cabang", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, entries }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setSaved(true);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setSaving(false); }
  }
  const total = rows.reduce((a, r) => a + Number(vals[r.cabang] || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Target per Cabang <span className="text-muted-foreground font-normal">(tahunan)</span></h3>
          {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-4 font-medium">Cabang</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Target {year} (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cabang} className="border-t">
                  <td className="py-2 pr-4 font-medium">{r.cabang}</td>
                  <td className="px-2 py-2"><RegionPill region={r.region} /></td>
                  <td className="px-2 py-2">
                    <CurrencyInput value={vals[r.cabang] ?? ""} onChange={(raw) => { setVals((p) => ({ ...p, [r.cabang]: raw })); setSaved(false); }} placeholder="0" className="bg-card h-8 w-full" />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr className="border-t"><td colSpan={3} className="text-muted-foreground py-3 text-xs">Belum ada cabang di Territory. Isi via WatchPoint → Territory.</td></tr>
              )}
              {rows.length > 0 && (
                <tr className="border-t"><td className="text-muted-foreground py-2 pr-4 text-xs">Total</td><td /><td className="text-muted-foreground px-2 py-2 text-right text-xs tabular-nums">Σ {rp(total)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <SaveButton saving={saving} saved={saved} disabled={loading || rows.length === 0} onClick={save} label="Simpan target cabang" />
      </CardContent>
    </Card>
  );
}

// ── Section 3: Target per AM (tahunan) ──
function AmTargets({ year }: { year: number }) {
  const [rows, setRows] = useState<AmRow[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets/am?year=${y}`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: AmRow[] };
      setRows(data.rows ?? []);
      setVals(Object.fromEntries((data.rows ?? []).map((r) => [r.am_id, r.target ? String(r.target) : ""])));
    } catch { setError("Gagal memuat target AM."); } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(year); }, [year, load]);

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const entries = rows.map((r) => ({ am_id: r.am_id, target: Number(vals[r.am_id] || 0) }));
      const res = await fetch("/api/sales/targets/am", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, entries }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setSaved(true);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setSaving(false); }
  }
  const total = rows.reduce((a, r) => a + Number(vals[r.am_id] || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Target per AM <span className="text-muted-foreground font-normal">(tahunan)</span></h3>
          {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-4 font-medium">AM</th>
                <th className="px-2 py-2 font-medium">Cabang</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Target {year} (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.am_id} className="border-t">
                  <td className="py-2 pr-4 font-medium">{r.nama}</td>
                  <td className="text-muted-foreground px-2 py-2">{r.cabang ?? "—"}</td>
                  <td className="px-2 py-2"><RegionPill region={r.region} /></td>
                  <td className="px-2 py-2">
                    <CurrencyInput value={vals[r.am_id] ?? ""} onChange={(raw) => { setVals((p) => ({ ...p, [r.am_id]: raw })); setSaved(false); }} placeholder="0" className="bg-card h-8 w-full" />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr className="border-t"><td colSpan={4} className="text-muted-foreground py-3 text-xs">Belum ada AM.</td></tr>
              )}
              {rows.length > 0 && (
                <tr className="border-t"><td className="text-muted-foreground py-2 pr-4 text-xs">Total</td><td /><td /><td className="text-muted-foreground px-2 py-2 text-right text-xs tabular-nums">Σ {rp(total)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <SaveButton saving={saving} saved={saved} disabled={loading || rows.length === 0} onClick={save} label="Simpan target AM" />
          <span className="text-muted-foreground text-xs">Cabang/region diatur di <Link href="/am-cabang" className="text-primary hover:underline">AM → Cabang</Link> &amp; <Link href="/watchpoint/territory" className="text-primary hover:underline">Territory</Link>.</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function SalesTargetForm() {
  const [year, setYear] = useState(nowYear);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="target-year" className="text-muted-foreground text-xs">Tahun</Label>
        <Input id="target-year" type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value) || nowYear)} className="bg-card h-8 w-28" />
      </div>
      <RegionTargets year={year} />
      <CabangTargets year={year} />
      <AmTargets year={year} />
    </div>
  );
}
