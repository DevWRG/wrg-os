"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface RaciPerson {
  id: string; nama: string; role: string | null;
  dept: string | null; dept_label: string | null; dept_color: string | null;
}
export interface RaciMatrixData {
  processes: { name: string; count: number }[];
  people: RaciPerson[];
  cells: { process: string; employee_id: string; role_type: string; note: string | null }[];
}

/**
 * Posisi form PIC (F157) per karyawan, dipakai sebagai KETERANGAN di matriks —
 * bukan sumber selnya. Seseorang boleh merangkap, jadi ini daftar.
 *
 * `proses` sengaja per-posisi dan TIDAK dijumlahkan jadi beban satu orang:
 * angkanya dihitung per posisi di form, dua posisi bisa memuat proses yang sama.
 */
export type PosisiIndex = Record<string, { nama: string; proses: number }[]>;

type Bucket = "A" | "R" | "C" | "I";
// role_type bisa gabungan (mis. "A/R", "C/R") → petakan ke bucket prioritas A>R>C>I.
function roleBucket(rt: string): Bucket {
  const u = rt.toUpperCase();
  if (u.includes("A")) return "A";
  if (u.includes("R")) return "R";
  if (u.includes("C")) return "C";
  return "I";
}
function bucketStyle(b: Bucket): string {
  switch (b) {
    case "A": return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
    case "R": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
    case "C": return "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300";
    default: return "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300";
  }
}
const roleStyle = (rt: string) => bucketStyle(roleBucket(rt));
const BUCKET_ORDER: Bucket[] = ["A", "R", "C", "I"];

const LEGEND: { k: Bucket; label: string }[] = [
  { k: "R", label: "Responsible (pelaksana)" },
  { k: "A", label: "Accountable (penanggung jawab)" },
  { k: "C", label: "Consulted (dikonsultasi)" },
  { k: "I", label: "Informed (diinformasikan)" },
];

// F120 RACI Matrix global. Dua view: "Per Proses" (padat — tiap proses → chip nama
// dikelompokkan R/A/C/I; default) & "Matriks" (grid proses × orang). Filter dept
// berlaku di keduanya. Sumber: raci_assignment (spine F118).
//
// 2026-09-19: matriks ini boleh MENAMPILKAN posisi form PIC (F157) lewat prop
// `posisi`, tapi tetap tidak mencampur sumbernya — sel R/A/C/I seluruhnya dari
// raci_assignment, posisi cuma keterangan tambahan pada orangnya. Alasannya
// pertanyaan "belum dipetakan — 22 karyawan" itu menyesatkan kalau dibaca dari
// sini: ke-22 orang itu SUDAH ada di matriks ini (semua 53 karyawan punya baris
// raci_assignment); yang belum ada cuma tautan ke posisi di form PIC. Menaruh
// keterangannya pada orang yang sama membuat itu terbaca langsung, tanpa harus
// membandingkan dua tabel di dua kartu berbeda.
export function RaciMatrix({ data, posisi }: { data: RaciMatrixData; posisi?: PosisiIndex }) {
  const [dept, setDept] = useState<string>("all");
  const [view, setView] = useState<"proses" | "matrix">("proses");
  const [hanyaTanpaPosisi, setHanyaTanpaPosisi] = useState(false);

  const depts = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.people) if (p.dept) m.set(p.dept, p.dept_label ?? p.dept);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [data.people]);

  // Tanpa prop `posisi` semua perilaku lama tak berubah: penanda, filter, dan
  // ringkasan cakupan tidak dirender sama sekali.
  const tanpaPosisi = useMemo(
    () => (posisi ? new Set(data.people.filter((p) => !posisi[p.id]?.length).map((p) => p.id)) : new Set<string>()),
    [data.people, posisi],
  );

  const peopleById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const cocok = useMemo(
    () => (p: RaciPerson) => (dept === "all" || p.dept === dept) && (!hanyaTanpaPosisi || tanpaPosisi.has(p.id)),
    [dept, hanyaTanpaPosisi, tanpaPosisi],
  );
  const people = useMemo(() => data.people.filter(cocok), [data.people, cocok]);

  // Matriks: lookup sel by "process employee".
  const cellMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data.cells) m.set(`${c.process} ${c.employee_id}`, c.role_type);
    return m;
  }, [data.cells]);

  // Per Proses: process → bucket → [{person, role_type}].
  const byProcess = useMemo(() => {
    const m = new Map<string, Record<Bucket, { p: RaciPerson; rt: string }[]>>();
    for (const c of data.cells) {
      const p = peopleById.get(c.employee_id);
      if (!p || !cocok(p)) continue;
      if (!m.has(c.process)) m.set(c.process, { A: [], R: [], C: [], I: [] });
      m.get(c.process)![roleBucket(c.role_type)].push({ p, rt: c.role_type });
    }
    return m;
  }, [data.cells, peopleById, cocok]);

  // Proses yang benar-benar punya sel di filter aktif. Tanpa ini, menyaring ke
  // satu dept (atau ke "belum punya posisi") menyisakan 5-10 baris/kotak proses
  // kosong yang cuma memakan layar — dan judulnya tetap menulis "12 proses"
  // seolah semuanya relevan.
  const prosesTampil = useMemo(() => {
    const ada = new Set<string>();
    for (const c of data.cells) { const p = peopleById.get(c.employee_id); if (p && cocok(p)) ada.add(c.process); }
    return data.processes.filter((pr) => ada.has(pr.name));
  }, [data.processes, data.cells, peopleById, cocok]);

  // Judul posisi untuk tooltip & baris kecil. Dipakai di dua view, jadi satu tempat.
  const labelPosisi = (id: string) => {
    const list = posisi?.[id];
    if (!list?.length) return "belum ada posisi di form PIC";
    return list.map((x) => `${x.nama} (${x.proses} proses)`).join(" · ");
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Matriks RACI — {prosesTampil.length} proses × {people.length} orang</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {LEGEND.map((l) => (
              <span key={l.k} className="flex items-center gap-1.5">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded font-bold ${bucketStyle(l.k)}`}>{l.k}</span>
                <span className="text-muted-foreground">{l.label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border p-1">
            {([["proses", "Per Proses"], ["matrix", "Matriks"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setView(k)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${view === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setDept("all")}
              className={`rounded-full border px-2.5 py-1 text-xs ${dept === "all" ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>
              Semua ({data.people.length})
            </button>
            {depts.map((d) => (
              <button key={d.key} onClick={() => setDept(d.key)}
                className={`rounded-full border px-2.5 py-1 text-xs ${dept === d.key ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>
                {d.label}
              </button>
            ))}
          </div>
          {posisi && tanpaPosisi.size > 0 && (
            <button
              onClick={() => setHanyaTanpaPosisi((v) => !v)}
              title="Saring ke orang yang belum punya tautan posisi di form PIC. Sel R/A/C/I mereka tetap ada — yang belum ada cuma posisinya."
              className={`rounded-full border px-2.5 py-1 text-xs ${hanyaTanpaPosisi ? "border-amber-400 bg-amber-50 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "border-border hover:bg-muted"}`}
            >
              ● Belum punya posisi ({tanpaPosisi.size})
            </button>
          )}
        </div>
        {posisi && (
          <p className="text-muted-foreground text-xs">
            Semua {data.people.length} karyawan sudah punya baris RACI di sini.{" "}
            <strong>{data.people.length - tanpaPosisi.size}</strong> di antaranya juga tertaut ke posisi di
            form PIC; {tanpaPosisi.size} sisanya ditandai ● dan bisa ditetapkan di kartu{" "}
            <a href="#posisi-form-pic" className="underline underline-offset-2 hover:text-foreground">Posisi &amp; proses per karyawan</a> di bawah.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {view === "proses" ? (
          <div className="grid gap-3 md:grid-cols-2">
            {prosesTampil.map((pr) => {
              const buckets = byProcess.get(pr.name);
              const total = buckets ? BUCKET_ORDER.reduce((s, b) => s + buckets[b].length, 0) : 0;
              return (
                <div key={pr.name} className="rounded-lg border p-3">
                  <div className="mb-2 text-sm font-semibold">{pr.name}</div>
                  {total === 0 ? (
                    <p className="text-muted-foreground text-xs">Tak ada assignment di filter ini.</p>
                  ) : (
                    <div className="space-y-2">
                      {BUCKET_ORDER.filter((b) => buckets && buckets[b].length > 0).map((b) => (
                        <div key={b} className="flex flex-wrap items-start gap-1.5">
                          <span className={`inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1 text-xs font-bold ${bucketStyle(b)}`}>{b}</span>
                          {buckets![b].map(({ p, rt }, i) => (
                            <span key={`${p.id}-${i}`}
                              title={`${p.role ?? ""}${p.dept_label ? ` · ${p.dept_label}` : ""}${rt !== b ? ` · ${rt}` : ""}${posisi ? `\nPosisi (form PIC): ${labelPosisi(p.id)}` : ""}`}
                              className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                              {p.nama}
                              {rt !== b && <span className="text-muted-foreground text-[10px] font-semibold">{rt}</span>}
                              {tanpaPosisi.has(p.id) && (
                                <span aria-label="belum punya posisi di form PIC" className="text-amber-600 dark:text-amber-400">●</span>
                              )}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="bg-card sticky left-0 z-10 border-b border-border p-2 text-left align-bottom font-medium min-w-[14rem]">Proses</th>
                  {people.map((p) => {
                    const pos = posisi?.[p.id];
                    return (
                      <th key={p.id} title={`${p.nama}${p.role ? ` — ${p.role}` : ""}${posisi ? `\nPosisi (form PIC): ${labelPosisi(p.id)}` : ""}`}
                        className="border-b border-border p-2 align-bottom text-xs font-medium min-w-[4.5rem] max-w-[7rem]">
                        <div className="truncate">{p.nama}</div>
                        {p.dept_label && <div className="text-muted-foreground truncate text-[10px] font-normal">{p.dept_label}</div>}
                        {posisi && (
                          pos?.length ? (
                            // Nama posisi dipotong keras: kolomnya sempit dan yang
                            // penting di sini cuma "ada/tidak" + detail di tooltip.
                            <div className="text-muted-foreground truncate text-[10px] font-normal">
                              {pos[0].nama}{pos.length > 1 ? ` +${pos.length - 1}` : ""}
                            </div>
                          ) : (
                            <div className="truncate text-[10px] font-normal text-amber-600 dark:text-amber-400">● belum ada posisi</div>
                          )
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {prosesTampil.map((pr) => (
                  <tr key={pr.name} className="hover:bg-muted/40">
                    <td className="bg-card sticky left-0 z-10 border-b border-border p-2 align-middle font-medium min-w-[14rem]">{pr.name}</td>
                    {people.map((p) => {
                      const rt = cellMap.get(`${pr.name} ${p.id}`);
                      return (
                        <td key={p.id} className="border-b border-border p-1 text-center align-middle">
                          {rt && <span className={`inline-flex min-w-[1.5rem] items-center justify-center rounded px-1 py-0.5 text-xs font-bold ${roleStyle(rt)}`}>{rt}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === "matrix" && people.length === 0 && <p className="text-muted-foreground py-6 text-center text-sm">Tidak ada karyawan di filter ini.</p>}
      </CardContent>
    </Card>
  );
}
