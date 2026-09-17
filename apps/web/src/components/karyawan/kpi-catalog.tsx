"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PERSP, PORDER, perspColor, perspLabel } from "@/components/karyawan/perspektif";

// F157b — tab KPI di Karyawan 360.
//
// Katalog, BUKAN penilaian kedua: skor komposit tetap satu pintu di tab Raport.
// Yang dijawab halaman ini cuma "KPI apa saja yang dipegang siapa, dan sudah
// diukur atau belum".
//
// Semua baris dikirim sekaligus (194) — tanpa limit tersembunyi, supaya kartu
// hitungan di atas tabel tidak berbohong terhadap isi tabelnya.

interface Row {
  id: string; employee_id: string; nama: string; panggilan: string | null; role: string | null;
  dept: string | null; dept_label: string | null;
  divisi_key: string | null; divisi_label: string | null;
  name: string; target: string | null; frequency: string | null;
  perspective: string | null; lower_better: boolean;
  achievement_pct: number | null; actual: string | null; tanpa_angka: boolean;
}
interface Resp { period: string; count: number; total_rows: number; rows: Row[] }

// Periode pengukuran KPI ber-grain BULAN (kpi_measurement.period = 'YYYY-MM'),
// beda dengan PeriodPicker raport yang kuartal/semester. Sengaja tidak memakai
// komponen itu supaya tidak ada periode kuartal yang dikirim ke endpoint bulanan
// lalu balik "belum diukur" semua.
function wibNow() {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function defaultMonth() {
  const w = wibNow();
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, "0")}`;
}
function lastMonths(n: number) {
  const w = wibNow();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const labelMonth = (p: string) => {
  const [y, m] = p.split("-");
  return `${BULAN[Number(m) - 1] ?? m} ${y}`;
};

export function KpiCatalog() {
  const [period, setPeriod] = useState(defaultMonth);
  const [data, setData] = useState<Resp | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [q, setQ] = useState("");
  const [divisi, setDivisi] = useState("");
  const [persp, setPersp] = useState("");

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- muat ulang saat ganti periode; disengaja.
    setState("loading");
    fetch(`/api/employee-spine/kpi?period=${encodeURIComponent(period)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as Resp;
      })
      .then((d) => { if (alive) { setData(d); setState("idle"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [period]);

  const all = useMemo(() => data?.rows ?? [], [data]);

  const divisiOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) if (r.divisi_key) m.set(r.divisi_key, r.divisi_label ?? r.divisi_key);
    return [...m.entries()];
  }, [all]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((r) =>
      (!divisi || r.divisi_key === divisi) &&
      (!persp || r.perspective === persp) &&
      (!s ||
        r.name.toLowerCase().includes(s) ||
        r.nama.toLowerCase().includes(s) ||
        (r.role ?? "").toLowerCase().includes(s) ||
        (r.target ?? "").toLowerCase().includes(s)),
    );
  }, [all, q, divisi, persp]);

  const stat = useMemo(() => {
    const orang = new Set(rows.map((r) => r.employee_id)).size;
    const diukur = rows.filter((r) => r.achievement_pct != null).length;
    const tanpaAngka = rows.filter((r) => r.tanpa_angka).length;
    return { total: rows.length, orang, diukur, tanpaAngka };
  }, [rows]);

  const grouped = useMemo(() => {
    const m = new Map<string, { label: string; rows: Row[] }>();
    for (const r of rows) {
      const k = r.divisi_key ?? "__none__";
      const g = m.get(k);
      if (g) g.rows.push(r);
      else m.set(k, { label: r.divisi_label ?? "Belum terpetakan ke divisi", rows: [r] });
    }
    return [...m.entries()];
  }, [rows]);

  const sel = "border-input bg-card h-8 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari KPI / nama / target…"
          className="bg-card border-border h-8 w-64 max-w-full"
        />
        <select value={divisi} onChange={(e) => setDivisi(e.target.value)} className={sel}>
          <option value="">Semua divisi</option>
          {divisiOpts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={persp} onChange={(e) => setPersp(e.target.value)} className={sel}>
          <option value="">Semua perspektif</option>
          {PORDER.map((p) => <option key={p} value={p}>{PERSP[p].label}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Periode ukur</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={sel}>
            {lastMonths(15).map((p) => <option key={p} value={p}>{labelMonth(p)}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [String(stat.total), "KPI tercatat"],
          [String(stat.orang), "Orang"],
          [`${stat.diukur}`, `Punya pengukuran ${labelMonth(period)}`],
          [`${stat.tanpaAngka}`, "Persentase tanpa angka pendukung"],
        ].map(([n, label]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-muted-foreground text-xs">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {state === "error" ? (
        <p className="text-muted-foreground">Gagal memuat katalog KPI.</p>
      ) : state === "loading" && !all.length ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : (
        <>
          {grouped.map(([key, g]) => (
            <Card key={key}>
              <CardContent className="p-0">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2">
                  <span className="text-sm font-medium">{g.label}</span>
                  <span className="text-muted-foreground text-xs">{g.rows.length} KPI</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground border-b text-left text-xs">
                      <tr>
                        <th className="px-4 py-2">Orang</th>
                        <th className="px-4 py-2">KPI</th>
                        <th className="px-4 py-2">Target</th>
                        <th className="px-4 py-2">Frekuensi</th>
                        <th className="px-4 py-2">Perspektif</th>
                        <th className="px-4 py-2 text-center">Arah</th>
                        <th className="px-4 py-2 text-right">Capaian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-4 py-2">
                            <div className="font-medium">{r.panggilan || r.nama}</div>
                            <div className="text-muted-foreground text-xs">{r.role ?? "—"}</div>
                          </td>
                          <td className="px-4 py-2">{r.name}</td>
                          <td className="text-muted-foreground px-4 py-2">{r.target ?? "—"}</td>
                          <td className="text-muted-foreground px-4 py-2">{r.frequency ?? "—"}</td>
                          <td className="px-4 py-2">
                            <Badge variant="outline" className="whitespace-nowrap" style={{ color: perspColor(r.perspective), borderColor: perspColor(r.perspective) }}>
                              {perspLabel(r.perspective)}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-center" title={r.lower_better ? "Makin rendah makin baik" : "Makin tinggi makin baik"}>
                            {r.lower_better ? "▼" : "▲"}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {r.achievement_pct == null ? (
                              <span className="text-muted-foreground">Belum diukur</span>
                            ) : r.tanpa_angka ? (
                              <span className="text-amber-600" title="Persentase tercatat tanpa angka aktual pendukung">
                                {r.achievement_pct}% ⚠
                              </span>
                            ) : (
                              <span title={r.actual ?? undefined}>{r.achievement_pct}%</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
          {!rows.length ? <p className="text-muted-foreground text-sm">Tidak ada KPI yang cocok dengan filter.</p> : null}
        </>
      )}

      <Card>
        <CardContent className="text-muted-foreground space-y-1.5 p-4 text-xs">
          <div className="text-foreground text-sm font-medium">Cara membaca halaman ini</div>
          <p>
            Ini <b>katalog</b>, bukan penilaian. Skor komposit karyawan tetap satu pintu di tab <b>Raport</b>; penyuntingan
            KPI &amp; pengisian pengukuran tetap di <b>Kelola Profil</b>.
          </p>
          <p>
            <b>Belum diukur</b> = tidak ada baris pengukuran untuk periode itu. Tanda <span className="text-amber-600">⚠</span>{" "}
            = persentase tercatat tapi kolom angka aktualnya kosong — persentase seperti ini tidak bisa ditelusuri, jadi
            jangan dipakai menilai orang sebelum angkanya diisi.
          </p>
          <p>
            <b>Arah</b>: ▲ makin tinggi makin baik · ▼ makin rendah makin baik (mis. lead-time, DSO, jumlah error).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
