"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonCards, SkeletonLines } from "@/components/ui/loading";
import { perspColor, perspLabel } from "@/components/karyawan/perspektif";

// F157b — tab OKR di Karyawan 360.
//
// Dua lapis dalam satu halaman, TIDAK dijumlahkan:
//   · OKR Divisi   — dari 6 form PIC (migrasi 168). Sudah setahun mengendap di
//                    `divisi_okr`/`divisi_okr_kr` tanpa satu pun pembaca.
//   · OKR Personal — dari wawancara karyawan (spine F118).
// Keduanya memotret pekerjaan yang sama dari sudut berbeda; menjumlahkannya
// akan menghitung dua kali.

interface Objective { id: string; objective: string; perspective: string | null; key_results: string[] }
interface Divisi { key: string; label: string; pic_nama: string | null; hod_nama: string | null; objectives: Objective[] }
interface Personal {
  employee_id: string; nama: string; panggilan: string | null; role: string | null;
  dept: string | null; dept_label: string | null;
  divisi_key: string | null; divisi_label: string | null;
  objective: string | null; key_results: string[];
}
interface Resp {
  divisi: Divisi[]; personal: Personal[];
  counts: { divisi: number; objective: number; key_result: number; orang: number; key_result_personal: number };
}

function PerspBadge({ p }: { p: string | null }) {
  return (
    <Badge variant="outline" className="whitespace-nowrap" style={{ color: perspColor(p), borderColor: perspColor(p) }}>
      {perspLabel(p)}
    </Badge>
  );
}

export function OkrOverview() {
  const [data, setData] = useState<Resp | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/employee-spine/okr")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as Resp;
      })
      .then((d) => { if (alive) { setData(d); setState("idle"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, []);

  const personalByDivisi = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = (data?.personal ?? []).filter((p) =>
      !s ||
      p.nama.toLowerCase().includes(s) ||
      (p.role ?? "").toLowerCase().includes(s) ||
      (p.objective ?? "").toLowerCase().includes(s) ||
      p.key_results.some((k) => k.toLowerCase().includes(s)),
    );
    const byKey = new Map<string, Personal[]>();
    for (const p of rows) {
      const k = p.divisi_key ?? "__none__";
      const arr = byKey.get(k);
      if (arr) arr.push(p);
      else byKey.set(k, [p]);
    }
    return byKey;
  }, [data, q]);

  if (state === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonCards count={4} />
        <SkeletonLines rows={6} />
      </div>
    );
  }
  if (state === "error" || !data) return <p className="text-muted-foreground">Gagal memuat OKR.</p>;

  const c = data.counts;
  const filteredCount = [...personalByDivisi.values()].reduce((s, v) => s + v.length, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [c.objective, "Objective divisi"],
          [c.key_result, "Key result divisi"],
          [c.orang, "Orang ber-OKR personal"],
          [c.key_result_personal, "Key result personal"],
        ].map(([n, label]) => (
          <Card key={String(label)}>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold tabular-nums">{n}</div>
              <div className="text-muted-foreground text-xs">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">OKR Divisi</h3>
          <p className="text-muted-foreground text-sm">
            Disusun PIC tiap divisi di form PIC Divisi, disahkan HOD. Perspektif <b>—</b> berarti PIC belum menentukannya.
          </p>
        </div>
        {data.divisi.map((d) => (
          <Card key={d.key}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium">{d.label}</div>
                <div className="text-muted-foreground text-xs">
                  PIC {d.pic_nama ?? "—"} · HOD {d.hod_nama ?? "—"} · {d.objectives.length} objective
                </div>
              </div>
              {d.objectives.length ? (
                <div className="space-y-3">
                  {d.objectives.map((o) => (
                    <div key={o.id} className="border-l-2 pl-3" style={{ borderColor: perspColor(o.perspective) }}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="text-sm font-medium">{o.objective}</div>
                        <PerspBadge p={o.perspective} />
                      </div>
                      <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5 text-sm">
                        {o.key_results.length
                          ? o.key_results.map((k, i) => <li key={i}>{k}</li>)
                          : <li className="list-none pl-0 italic">Objective tanpa key result.</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm italic">Divisi ini belum mengisi OKR di form PIC.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">OKR Personal</h3>
            <p className="text-muted-foreground text-sm">
              Objective &amp; key result yang disebut karyawan sendiri saat wawancara profil.
            </p>
          </div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama / role / isi OKR…"
            className="bg-card border-border h-8 w-64 max-w-full"
          />
        </div>

        {data.divisi.map((d) => {
          const rows = personalByDivisi.get(d.key) ?? [];
          if (q.trim() && !rows.length) return null;
          return (
            <Card key={d.key}>
              <CardContent className="p-0">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2">
                  <span className="text-sm font-medium">{d.label}</span>
                  <span className="text-muted-foreground text-xs">{rows.length} orang</span>
                </div>
                {rows.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground border-b text-left text-xs">
                      <tr>
                        <th className="px-4 py-2">Orang</th>
                        <th className="px-4 py-2">Objective</th>
                        <th className="px-4 py-2">Key result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.employee_id} className="border-b last:border-0 align-top">
                          <td className="px-4 py-2">
                            <div className="font-medium">{p.panggilan || p.nama}</div>
                            <div className="text-muted-foreground text-xs">{p.role ?? "—"}</div>
                          </td>
                          <td className="px-4 py-2">{p.objective ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-2">
                            {p.key_results.length ? (
                              <ul className="list-disc space-y-0.5 pl-4">
                                {p.key_results.map((k, i) => <li key={i}>{k}</li>)}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-muted-foreground px-4 py-3 text-sm italic">
                    Belum ada karyawan yang tertaut ke divisi ini.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {q.trim() ? (
          <p className="text-muted-foreground text-xs">{filteredCount} dari {data.personal.length} orang cocok dengan pencarian.</p>
        ) : null}
      </section>

      <Card>
        <CardContent className="text-muted-foreground space-y-1.5 p-4 text-xs">
          <div className="text-foreground text-sm font-medium">Cara membaca halaman ini</div>
          <p>
            <b>OKR Divisi</b> berasal dari form PIC (grain divisi, deklaratif). <b>OKR Personal</b> berasal dari wawancara
            karyawan (grain orang). Keduanya memotret pekerjaan yang sama dari sudut berbeda — <b>jangan dijumlahkan</b>.
          </p>
          <p>
            Divisi yang tertulis &quot;belum ada karyawan tertaut&quot; bukan divisi kosong: pemetaannya lewat departemen,
            dan ada divisi yang memang belum punya baris pemetaan sama sekali.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
