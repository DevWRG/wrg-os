"use client";

import { useMemo, useState } from "react";

// 308/311 — halaman detail Daily Summary (/ds/<token>). Mobile-first: angka di atas, siapa yang belum report/plan,
// lalu kartu per HOD (cabang tanggung jawabnya) berisi item TUA (outstanding > 4 jam dari resume grup WA) dan
// ringkasan aktivitas per area/orang. Bisa dicari (nama/aktivitas/TUA) dan disaring per HOD.

export interface OrangDs { nama: string; isi: string }
export interface AreaDs { area: string; orang: OrangDs[] }
export interface ItemTua { topik: string; dari: string | null; ke: string | null; umur: string | null; status: string | null; cabang: string | null; hod_key: string | null }
export interface KelompokHod { hod_key: string; nama: string; cabang: string[]; tua: ItemTua[]; areas: AreaDs[] }
export interface DsPublik {
  tanggal: string;
  hari: string;
  label: string;
  stats: { anggota_aktif: number; total_report: number; matched: number; unmatched: number; wajib_total: number; matched_pct: number };
  daftar: { non_reporters: string[]; no_plan: string[]; on_leave: string[] };
  areas: AreaDs[];
  highlight: string[];
  diubah_at: string;
  /** 311 — boleh tak ada pada data lama. */
  per_hod?: KelompokHod[];
  tanpa_hod?: { areas: AreaDs[]; tua: ItemTua[] };
  tua_sumber?: string | null;
}

const TANPA = "__tanpa__";
const judul = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function Angka({ nilai, label, nada = "slate" }: { nilai: string; label: string; nada?: "slate" | "teal" | "amber" }) {
  const warna = nada === "teal" ? "text-teal-700" : nada === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div className={`text-2xl font-bold tabular-nums ${warna}`}>{nilai}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{label}</div>
    </div>
  );
}

function Daftar({ judul: j, nama, nada }: { judul: string; nama: string[]; nada: "red" | "amber" | "sky" }) {
  if (!nama.length) return null;
  const kelas = { red: "bg-red-50 text-red-800 ring-red-200", amber: "bg-amber-50 text-amber-800 ring-amber-200", sky: "bg-sky-50 text-sky-800 ring-sky-200" }[nada];
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">{j} ({nama.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {nama.map((n) => <span key={n} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${kelas}`}>{n}</span>)}
      </div>
    </div>
  );
}

function DaftarTua({ tua, sumber }: { tua: ItemTua[]; sumber: string | null }) {
  return (
    <div className="mx-4 mb-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <div className="text-sm font-semibold text-amber-900">
        ⏳ TUA ({tua.length}) <span className="text-xs font-normal text-amber-800">· outstanding &gt; 4 jam{sumber ? `, per ${sumber}` : ", belum ada resume hari ini"}</span>
      </div>
      {tua.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {tua.map((t, i) => (
            <li key={`${t.topik}-${i}`} className="text-sm">
              <div className="font-medium text-slate-900">{t.topik}</div>
              <div className="text-xs leading-relaxed text-slate-600">
                {[t.ke && `ke ${t.ke}`, t.dari && `dari ${t.dari}`, t.umur, t.status && `status: ${t.status}`].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-xs text-amber-800">Tidak ada.</div>
      )}
    </div>
  );
}

function Area({ a }: { a: AreaDs }) {
  return (
    <details open className="group border-t border-slate-100">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-semibold">
        <span>{a.area}</span>
        <span className="flex items-center gap-2 text-xs font-normal text-slate-500">{a.orang.length} orang <span className="transition group-open:rotate-90">▸</span></span>
      </summary>
      <ul className="divide-y divide-slate-100">
        {a.orang.map((o) => (
          <li key={`${a.area}-${o.nama}`} className="px-4 py-2.5">
            <div className="text-sm font-medium">{o.nama}</div>
            {o.isi && <div className="mt-0.5 text-sm leading-relaxed text-slate-600">{o.isi}</div>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function DailySummaryPublik({ data }: { data: DsPublik }) {
  const [cari, setCari] = useState("");
  const [pilih, setPilih] = useState("");
  const s = data.stats;
  const q = cari.trim().toLowerCase();
  const sumber = data.tua_sumber ?? null;
  const per = useMemo(() => data.per_hod ?? [], [data.per_hod]);

  // data lama (sebelum 311) tanpa per_hod → satu kelompok berisi semua area
  const kelompok = useMemo(() => {
    const sisa = data.tanpa_hod ?? { areas: per.length ? [] : data.areas, tua: [] };
    const semua = [
      ...per.map((h) => ({ key: h.hod_key, judul: `HOD ${h.nama}`, sub: h.cabang.map(judul).join(", "), tua: h.tua, areas: h.areas })),
      { key: TANPA, judul: per.length ? "Pusat & tanpa HOD" : "Semua area", sub: per.length ? "cabang tanpa HOD dan item TUA yang belum terpetakan" : "", tua: sisa.tua, areas: sisa.areas },
    ];
    return semua
      .filter((g) => !pilih || g.key === pilih)
      .map((g) => ({
        ...g,
        areas: g.areas
          .map((a) => ({ ...a, orang: q ? a.orang.filter((o) => `${o.nama} ${o.isi} ${a.area}`.toLowerCase().includes(q)) : a.orang }))
          .filter((a) => a.orang.length),
        tua: q ? g.tua.filter((t) => `${t.topik} ${t.ke ?? ""} ${t.dari ?? ""} ${t.status ?? ""}`.toLowerCase().includes(q)) : g.tua,
      }))
      .filter((g) => g.areas.length || g.tua.length || (!q && g.key !== TANPA));
  }, [data.tanpa_hod, data.areas, per, pilih, q]);
  const pilihan = per.length ? [...per.map((h) => ({ key: h.hod_key, label: `HOD ${h.nama}` })), { key: TANPA, label: "Pusat & tanpa HOD" }] : [];
  const jumlahOrang = kelompok.reduce((n, g) => n + g.areas.reduce((m, a) => m + a.orang.length, 0), 0);
  const adaTua = per.length > 0 || sumber !== null;

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
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{data.highlight.map((h) => <li key={h}>{h}</li>)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex gap-2">
          <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama, customer, aktivitas, TUA…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600" />
          {pilihan.length > 0 && (
            <select value={pilih} onChange={(e) => setPilih(e.target.value)} aria-label="Saring HOD"
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
              <option value="">Semua HOD</option>
              {pilihan.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
        </div>
        <div className="text-xs text-slate-500">{jumlahOrang} orang · {kelompok.length} kelompok</div>

        {kelompok.map((g) => (
          <div key={g.key} className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="px-4 pb-3 pt-4">
              <div className="text-base font-bold">{g.judul}</div>
              {g.sub && <div className="mt-0.5 text-xs text-slate-500">{g.sub}</div>}
            </div>
            {adaTua && <DaftarTua tua={g.tua} sumber={sumber} />}
            {g.areas.map((a) => <Area key={`${g.key}-${a.area}`} a={a} />)}
            {!g.areas.length && <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">Belum ada laporan dari cabang ini.</div>}
          </div>
        ))}
        {kelompok.length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Tidak ada yang cocok.</div>}
      </section>
    </div>
  );
}
