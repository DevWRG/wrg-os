"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Plus, Trash2 } from "lucide-react";
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">Nilai dalam Rupiah penuh (mis. 125000000000).</span>
          <SaveButton saving={saving} saved={saved} disabled={loading} onClick={save} />
        </div>
      </CardContent>
    </Card>
  );
}

interface CabangRow { cabang: string; region: string; target: number }
interface AmRow { am_id: string; nama: string; cabang: string | null; region: string; target: number; target_customer: number }

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
        <div className="flex justify-end">
          <SaveButton saving={saving} saved={saved} disabled={loading || rows.length === 0} onClick={save} label="Simpan target cabang" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 3: Target per AM (tahunan) ──
interface AmCandidate { am_id: string; nama: string; cabang: string | null; region: string; role: string | null }

function AmTargets({ year }: { year: number }) {
  const [rows, setRows] = useState<AmRow[]>([]);
  const [candidates, setCandidates] = useState<AmCandidate[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  // Target jumlah customer aktif per AM (078) — dipakai aspek NPK "Customer".
  const [custVals, setCustVals] = useState<Record<string, string>>({});
  const [addSel, setAddSel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets/am?year=${y}`, { cache: "no-store" });
      const data = (await res.json()) as { rows?: AmRow[]; candidates?: AmCandidate[] };
      setRows(data.rows ?? []);
      setCandidates(data.candidates ?? []);
      setVals(Object.fromEntries((data.rows ?? []).map((r) => [r.am_id, r.target ? String(r.target) : ""])));
      setCustVals(Object.fromEntries((data.rows ?? []).map((r) => [r.am_id, r.target_customer ? String(r.target_customer) : ""])));
    } catch { setError("Gagal memuat target AM."); } finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(year); }, [year, load]);

  // Tambah AM dari picker (master_user) → buat row target 0, lalu reload.
  async function addAm(am_id: string) {
    if (!am_id) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch("/api/sales/targets/am", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, entries: [{ am_id, target: 0 }] }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "gagal menambah");
      setAddSel("");
      await load(year);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); }
  }

  async function removeAm(am_id: string) {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`/api/sales/targets/am?year=${year}&am_id=${encodeURIComponent(am_id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "gagal menghapus");
      await load(year);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setBusy(false); }
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const entries = rows.map((r) => ({
        am_id: r.am_id,
        target: Number(vals[r.am_id] || 0),
        target_customer: Number(custVals[r.am_id] || 0),
      }));
      const res = await fetch("/api/sales/targets/am", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ year, entries }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setSaved(true);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); } finally { setSaving(false); }
  }
  const total = rows.reduce((a, r) => a + Number(vals[r.am_id] || 0), 0);
  const totalCust = rows.reduce((a, r) => a + Number(custVals[r.am_id] || 0), 0);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            Target per AM <span className="text-muted-foreground font-normal">(tahunan)</span>
            {(loading || busy) && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          </h3>
          {/* Picker + Tambah AM: pilih orang dari master_user yang belum ada di daftar. */}
          <div className="flex items-center gap-2">
            <select
              value={addSel}
              onChange={(e) => setAddSel(e.target.value)}
              disabled={busy || loading || candidates.length === 0}
              className="border-input bg-card h-8 max-w-[16rem] rounded-md border px-2 text-sm outline-none focus-visible:border-primary disabled:opacity-50"
            >
              <option value="">{candidates.length === 0 ? "Semua AM sudah ditambah" : "— pilih AM —"}</option>
              {candidates.map((c) => (
                <option key={c.am_id} value={c.am_id}>
                  {c.nama}{c.cabang ? ` · ${c.cabang}` : ""}{c.role ? ` (${c.role})` : ""}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => addAm(addSel)} disabled={!addSel || busy} className="bg-[#e44830] text-white shadow-sm hover:bg-[#c93c27]">
              <Plus /> Tambah AM
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-4 font-medium">AM</th>
                <th className="px-2 py-2 font-medium">Cabang</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Target {year} (Rp)</th>
                <th className="px-2 py-2 font-medium">Target Customer <span className="font-normal">(override NPK)</span></th>
                <th className="px-2 py-2" />
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
                  <td className="px-2 py-2">
                    {/* Jumlah faskes aktif setahun (bukan Rupiah) → Input angka biasa. */}
                    <Input
                      type="number" min={0} inputMode="numeric"
                      value={custVals[r.am_id] ?? ""}
                      onChange={(e) => { const v = e.target.value; setCustVals((p) => ({ ...p, [r.am_id]: v })); setSaved(false); }}
                      placeholder="0" aria-label={`Target customer ${r.nama}`} className="bg-card h-8 w-24"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={`Hapus ${r.nama}`} disabled={busy} onClick={() => removeAm(r.am_id)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr className="border-t"><td colSpan={6} className="text-muted-foreground py-3 text-xs">Belum ada AM di daftar. Tambah lewat <strong>+ Tambah AM</strong> di kanan atas.</td></tr>
              )}
              {rows.length > 0 && (
                <tr className="border-t"><td className="text-muted-foreground py-2 pr-4 text-xs">Total</td><td /><td /><td className="text-muted-foreground px-2 py-2 text-right text-xs tabular-nums">Σ {rp(total)}</td><td className="text-muted-foreground px-2 py-2 text-xs tabular-nums">Σ {rp(totalCust)}</td><td /></tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            <strong>Target Customer</strong> = <em>override</em> jumlah faskes aktif untuk aspek Customer di <Link href="/npk/am" className="text-primary hover:underline">NPK AM</Link>. Kosongkan saja bila mengikuti SK: targetnya otomatis turun dari golongan AM (Pasal 2.1) yang di-set di <Link href="/am-cabang" className="text-primary hover:underline">AM → Cabang</Link>. Isi di sini hanya untuk AM yang targetnya memang disepakati beda dari levelnya.
            Kelola AM/cabang di <Link href="/users" className="text-primary hover:underline">Users</Link>, <Link href="/am-cabang" className="text-primary hover:underline">AM → Cabang</Link> &amp; <Link href="/watchpoint/territory" className="text-primary hover:underline">Territory</Link>.
          </span>
          <SaveButton saving={saving} saved={saved} disabled={loading || rows.length === 0} onClick={save} label="Simpan target AM" />
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
