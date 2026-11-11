"use client";

import { useMemo, useState } from "react";

// 308 — tampilan halaman detail Daily Summary (/ds/<token>). Mobile-first: angka di atas, siapa yang belum
// report/plan, lalu kartu per area yang bisa dicari (nama/isi) dan disaring per area.

export interface OrangDs { nama: string; isi: string }
export interface AreaDs { area: string; orang: OrangDs[] }
export interface DsPublik {
  tanggal: string;
  hari: string;
  label: string;
  stats: { anggota_aktif: number; total_report: number; matched: number; unmatched: number; wajib_total: number; matched_pct: number };
  daftar: { non_reporters: string[]; no_plan: string[]; on_leave: string[] };
  areas: AreaDs[];
  highlight: string[];
  diubah_at: string;
}

function Angka({ nilai, label, nada = "slate" }: { nilai: string; label: string; nada?: "slate" | "teal" | "amber" }) {
  const warna = nada === "teal" ? "text-teal-700" : nada === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className={`text-2xl font-bold tabular-nums ${warna}`}>{nilai}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{label}</div>
    </div>
  );
}

function Daftar({ judul, nama, nada }: { judul: string; nama: string[]; nada: "red" | "amber" | "sky" }) {
  if (!nama.length) return null;
  const kelas = { red: "bg-red-50 text-red-800 ring-red-200", amber: "bg-amber-50 text-amber-800 ring-amber-200", sky: "bg-sky-50 text-sky-800 ring-sky-200" }[nada];
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">{judul} ({nama.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {nama.map((n) => (
          <span key={n} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${kelas}`}>{n}</span>
        ))}
      </div>
    </div>
  );
}

export function DailySummaryPublik({ data }: { data: DsPublik }) {
  const [cari, setCari] = useState("");
  const [area, setArea] = useState("");
  const s = data.stats;
  const q = cari.trim().toLowerCase();
  const tampil = useMemo(
    () => data.areas
      .filter((a) => !area || a.area === area)
      .map((a) => ({ ...a, orang: q ? a.orang.filter((o) => `${o.nama} ${o.isi}`.toLowerCase().includes(q)) : a.orang }))
      .filter((a) => a.orang.length),
    [data.areas, area, q],
  );
  const jumlahOrang = tampil.reduce((n, a) => n + a.orang.length, 0);

  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-gradient-to-br from-[#0a8a9e] to-[#2bd4a8] p-5 text-white shadow">
        <div className="text-xs font-medium uppercase tracking-wide opacity-90">Daily Summary</div>
        <h1 className="mt-1 text-xl font-bold">{data.hari}, {data.label}</h1>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <Angka nilai={`${s.anggota_aktif}/${s.wajib_total}`} label="tim lapor" nada="teal" />
        <Angka nilai={String(s.total_report)} label="laporan masuk" />
        <Angka nilai={`${s.matched_pct}%`} label={`sesuai plan · ${s.unmatched} di luar`} nada={s.matched_pct < 80 ? "amber" : "teal"} />
      </section>

      {(data.daftar.non_reporters.length > 0 || data.daftar.no_plan.length > 0 || data.daftar.on_leave.length > 0) && (
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <Daftar judul="⚠️ Belum report" nama={data.daftar.non_reporters} nada="red" />
          <Daftar judul="📝 Belum plan" nama={data.daftar.no_plan} nada="amber" />
          <Daftar judul="🌴 Ijin" nama={data.daftar.on_leave} nada="sky" />
        </section>
      )}

      {data.highlight.length > 0 && (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-1.5 text-sm font-semibold">💡 Highlight</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {data.highlight.map((h) => <li key={h}>{h}</li>)}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex gap-2">
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama, customer, aktivitas…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
            aria-label="Saring area"
          >
            <option value="">Semua area</option>
            {data.areas.map((a) => <option key={a.area} value={a.area}>{a.area} ({a.orang.length})</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500">{jumlahOrang} orang · {tampil.length} area</div>

        {tampil.map((a) => (
          <details key={a.area} open className="group rounded-2xl bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold">
              <span>{a.area}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-slate-500">
                {a.orang.length} orang <span className="transition group-open:rotate-90">▸</span>
              </span>
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {a.orang.map((o) => (
                <li key={`${a.area}-${o.nama}`} className="px-4 py-3">
                  <div className="text-sm font-medium">{o.nama}</div>
                  {o.isi && <div className="mt-0.5 text-sm leading-relaxed text-slate-600">{o.isi}</div>}
                </li>
              ))}
            </ul>
          </details>
        ))}
        {tampil.length === 0 && (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Tidak ada yang cocok.</div>
        )}
      </section>
    </div>
  );
}
