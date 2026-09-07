"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Badge } from "@/components/ui/badge";

// Muka data 6 form PIC Divisi (migrasi 168/170/171). Read-only — form-nya
// diisi di Excel & masuk lewat importer, jadi tak ada tombol simpan di sini.

export interface LevelBucket { level: string | null; jumlah: number }
export interface DivisiOtomasi {
  divisi_key: string; divisi: string; sop: number; langkah: number;
  kondisi: LevelBucket[]; target: LevelBucket[]; naik: number; target_kosong: number;
}
export interface Summary {
  total_sop: number; total_langkah: number; kondisi: LevelBucket[]; target: LevelBucket[];
  naik: number; target_kosong: number; per_divisi: DivisiOtomasi[];
}
export interface LangkahRow {
  id: number; divisi_key: string; divisi: string; sop: string; seq: number;
  langkah: string; kondisi: string | null; kondisi_raw: string | null;
  target_level: string | null; target_raw: string | null; catatan: string | null;
}
export interface RaciRow {
  tugas_id: number; divisi_key: string; divisi: string; proses: string;
  r_responsible: string; a_accountable: string | null; a_belum_kanonik: boolean;
  frekuensi: string | null; kpi_target: string | null;
}
export interface KelengkapanRow {
  divisi_key: string; divisi: string; pic_nama: string | null;
  posisi: number; tugas: number; sop: number; langkah_sop: number;
  koordinasi: number; objective: number;
  pct_tugas_ada_kpi: number | null; pct_tugas_ada_pj: number | null;
  pct_pj_kanonik: number | null; pct_langkah_ada_kondisi: number | null;
  pct_langkah_ada_target: number | null;
  pct_koordinasi_terklasifikasi: number | null;
  pct_objective_ada_perspektif: number | null;
  terpetakan_ke_department: boolean;
}

const LEVEL_URUT = ["Manual", "Digitalisasi", "Otomasi", "AI"] as const;

// Warna naik searah kematangan (abu → biru → hijau → ungu) supaya perbandingan
// dua kolom "sekarang vs target" bisa dibaca dari pergeseran warnanya saja.
const LEVEL_GAYA: Record<string, string> = {
  Manual: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  Digitalisasi: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  Otomasi: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  AI: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
};
const GAYA_BELUM = "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";

const fmt = (n: number) => n.toLocaleString("id-ID");
const labelLevel = (l: string | null) => l ?? "belum diisi";
const gayaLevel = (l: string | null) => (l == null ? GAYA_BELUM : (LEVEL_GAYA[l] ?? GAYA_BELUM));

function ChipLevel({ level }: { level: string | null }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${gayaLevel(level)}`}>
      {labelLevel(level)}
    </span>
  );
}

/** Batang distribusi level. Penyebutnya `total` yang diberikan pemanggil —
 *  bukan jumlah bucket — supaya bucket "belum diisi" ikut terhitung. */
function BatangLevel({ judul, buckets, total }: { judul: string; buckets: LevelBucket[]; total: number }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{judul}</p>
      <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
        {buckets.filter((b) => b.jumlah > 0).map((b) => (
          <div
            key={labelLevel(b.level)}
            className={gayaLevel(b.level)}
            style={{ width: `${total > 0 ? (b.jumlah / total) * 100 : 0}%` }}
            title={`${labelLevel(b.level)}: ${fmt(b.jumlah)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {buckets.map((b) => (
          <span key={labelLevel(b.level)} className="text-xs text-muted-foreground">
            <ChipLevel level={b.level} /> {fmt(b.jumlah)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, nilai, catatan }: { label: string; nilai: string; catatan?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{nilai}</p>
      {catatan && <p className="text-xs text-muted-foreground">{catatan}</p>}
    </div>
  );
}

const LIMIT = 50;
type Halaman<T> = { rows: T[]; total_rows: number };

export function SopOtomasiView({
  summary, divisiOpts, kelengkapan,
}: {
  summary: Summary | null;
  divisiOpts: { value: string; label: string }[];
  kelengkapan: KelengkapanRow[];
}) {
  // ── tab Otomasi: tabel langkah (paginasi & filter di backend) ──
  const [fDivisi, setFDivisi] = useState("");
  const [fKondisi, setFKondisi] = useState("");
  const [fTarget, setFTarget] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(LIMIT);
  const [langkah, setLangkah] = useState<Halaman<LangkahRow>>({ rows: [], total_rows: 0 });
  const [muat, setMuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const ambilLangkah = useCallback(async () => {
    setMuat(true);
    setGalat(null);
    const p = new URLSearchParams({ limit: String(size), offset: String(page * size) });
    if (q.trim()) p.set("q", q.trim());
    if (fDivisi) p.set("divisi", fDivisi);
    if (fKondisi) p.set("kondisi", fKondisi);
    if (fTarget) p.set("target", fTarget);
    try {
      const r = await fetch(`/api/picform/sop-langkah?${p}`);
      const j = (await r.json()) as Halaman<LangkahRow> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setLangkah({ rows: j.rows ?? [], total_rows: j.total_rows ?? 0 });
    } catch (e) {
      // Galat dirender DI DEKAT tabelnya, bukan di atas halaman — supaya tak
      // terbaca sebagai kegagalan seluruh halaman saat tab lain masih sehat.
      setGalat(e instanceof Error ? e.message : "gagal memuat");
      setLangkah({ rows: [], total_rows: 0 });
    } finally {
      setMuat(false);
    }
  }, [q, fDivisi, fKondisi, fTarget, page, size]);

  useEffect(() => { void ambilLangkah(); }, [ambilLangkah]);
  // Ganti filter → balik ke halaman 1. Tanpa ini orang bisa terjebak di
  // halaman 5 dari hasil filter yang cuma punya 1 halaman, dan tabelnya kosong
  // tanpa penjelasan.
  useEffect(() => { setPage(0); }, [q, fDivisi, fKondisi, fTarget]);

  // ── tab RACI posisi ──
  const [rDivisi, setRDivisi] = useState("");
  const [rq, setRq] = useState("");
  const [rPage, setRPage] = useState(0);
  const [rSize, setRSize] = useState(LIMIT);
  const [raci, setRaci] = useState<Halaman<RaciRow>>({ rows: [], total_rows: 0 });
  const [rMuat, setRMuat] = useState(false);
  const [rGalat, setRGalat] = useState<string | null>(null);

  const ambilRaci = useCallback(async () => {
    setRMuat(true);
    setRGalat(null);
    const p = new URLSearchParams({ limit: String(rSize), offset: String(rPage * rSize) });
    if (rq.trim()) p.set("q", rq.trim());
    if (rDivisi) p.set("divisi", rDivisi);
    try {
      const r = await fetch(`/api/picform/raci?${p}`);
      const j = (await r.json()) as Halaman<RaciRow> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRaci({ rows: j.rows ?? [], total_rows: j.total_rows ?? 0 });
    } catch (e) {
      setRGalat(e instanceof Error ? e.message : "gagal memuat");
      setRaci({ rows: [], total_rows: 0 });
    } finally {
      setRMuat(false);
    }
  }, [rq, rDivisi, rPage, rSize]);

  useEffect(() => { void ambilRaci(); }, [ambilRaci]);
  useEffect(() => { setRPage(0); }, [rq, rDivisi]);

  const kolomLangkah: DataColumn<LangkahRow>[] = [
    { id: "divisi", header: "Divisi", accessor: (r) => r.divisi },
    { id: "sop", header: "SOP / Workflow", accessor: (r) => r.sop },
    { id: "langkah", header: "Langkah", accessor: (r) => r.langkah, className: "min-w-[18rem]" },
    {
      id: "kondisi", header: "Sekarang", accessor: (r) => r.kondisi ?? "",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <ChipLevel level={r.kondisi} />
          {/* Nilai mentah ditampilkan HANYA kalau menyimpang dari 4 level resmi
              (mis. 'Accurate', 'Manual (Excel)') — itu tanda formnya keluar
              dropdown, bukan hiasan. */}
          {r.kondisi_raw && r.kondisi_raw !== r.kondisi && (
            <span className="ml-1 text-xs text-muted-foreground">({r.kondisi_raw})</span>
          )}
        </span>
      ),
    },
    {
      id: "target", header: "Target", accessor: (r) => r.target_level ?? "",
      cell: (r) => (
        <span className="whitespace-nowrap">
          <ChipLevel level={r.target_level} />
          {r.target_raw && r.target_raw !== r.target_level && (
            <span className="ml-1 text-xs text-muted-foreground">({r.target_raw})</span>
          )}
        </span>
      ),
    },
    { id: "catatan", header: "Catatan", accessor: (r) => r.catatan ?? "", className: "min-w-[14rem]" },
  ];

  const kolomRaci: DataColumn<RaciRow>[] = [
    { id: "divisi", header: "Divisi", accessor: (r) => r.divisi },
    { id: "proses", header: "Proses / Tugas", accessor: (r) => r.proses, className: "min-w-[20rem]" },
    { id: "r", header: "R — Responsible (posisi)", accessor: (r) => r.r_responsible },
    {
      id: "a", header: "A — Accountable (PJ)", accessor: (r) => r.a_accountable ?? "",
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.a_accountable ?? <span className="text-muted-foreground">—</span>}
          {/* Ejaan PJ yang belum terdaftar di pj_alias ditandai, bukan
              disembunyikan — supaya kelihatan mana yang perlu satu INSERT. */}
          {r.a_belum_kanonik && (
            <Badge variant="outline" className="ml-1 text-[10px]">belum kanonik</Badge>
          )}
        </span>
      ),
    },
    { id: "frekuensi", header: "Frekuensi", accessor: (r) => r.frekuensi ?? "" },
    { id: "kpi", header: "Target / KPI", accessor: (r) => r.kpi_target ?? "", className: "min-w-[16rem]" },
  ];

  const pct = (v: number | null) =>
    // NULL ≠ 0%. NULL artinya penyebutnya nol ("tak ada barisnya"), 0% artinya
    // "ada barisnya tapi kosong semua". Meleburkannya menghapus perbedaan yang
    // justru jadi alasan view kelengkapan ini ada.
    v == null ? <span className="text-muted-foreground">—</span>
      : <span className={v < 50 ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{v}%</span>;

  if (!summary) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dan data form PIC sudah
          diimpor (<code>scripts/ops/pic-form-import.mjs --apply</code>).
        </p>
      </CardContent></Card>
    );
  }

  const totalLangkah = summary.total_langkah;

  return (
    <Tabs defaultValue="otomasi">
      <TabsList>
        <TabsTrigger value="otomasi">Otomasi SOP</TabsTrigger>
        <TabsTrigger value="raci">RACI Posisi</TabsTrigger>
        <TabsTrigger value="kelengkapan">Kelengkapan Form</TabsTrigger>
      </TabsList>

      <TabsContent value="otomasi" className="space-y-4">
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="SOP / Workflow" nilai={fmt(summary.total_sop)} />
            <Kpi label="Langkah" nilai={fmt(totalLangkah)} />
            <Kpi label="Rencana naik kelas" nilai={fmt(summary.naik)}
              catatan="target lebih tinggi dari kondisi sekarang" />
            <Kpi label="Target belum diisi" nilai={fmt(summary.target_kosong)}
              catatan={`dari ${fmt(totalLangkah)} langkah`} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              Dua baris di bawah <strong>bukan hal yang sama</strong>. Distribusi otomasi yang
              biasa dikutip dari blueprint operasional adalah baris <em>Target</em>; kondisi
              nyata sekarang ada di baris <em>Kondisi sekarang</em>. Membaca satu tanpa yang lain
              memberi kesimpulan yang berlawanan.
            </p>
            <div className="grid gap-6 lg:grid-cols-2">
              <BatangLevel judul="Kondisi sekarang" buckets={summary.kondisi} total={totalLangkah} />
              <BatangLevel judul="Target" buckets={summary.target} total={totalLangkah} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-xs font-medium text-muted-foreground">Per divisi</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Divisi</th>
                    <th className="py-2 pr-3 text-right font-medium">SOP</th>
                    <th className="py-2 pr-3 text-right font-medium">Langkah</th>
                    <th className="py-2 pr-3 font-medium">Kondisi sekarang</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 pr-3 text-right font-medium">Naik kelas</th>
                    <th className="py-2 text-right font-medium">Target kosong</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.per_divisi.map((d) => (
                    <tr key={d.divisi_key} className="border-b last:border-0">
                      <td className="py-2 pr-3">{d.divisi}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(d.sop)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(d.langkah)}</td>
                      <td className="py-2 pr-3">
                        <BatangKecil buckets={d.kondisi} total={d.langkah} />
                      </td>
                      <td className="py-2 pr-3">
                        <BatangKecil buckets={d.target} total={d.langkah} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(d.naik)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {d.target_kosong > 0
                          ? <span className="font-medium text-amber-700 dark:text-amber-300">{fmt(d.target_kosong)}</span>
                          : fmt(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Divisi" value={fDivisi} onChange={setFDivisi} options={divisiOpts} />
              <FilterSelect
                label="Sekarang" value={fKondisi} onChange={setFKondisi}
                options={[...LEVEL_URUT.map((l) => ({ value: l, label: l })), { value: "BELUM", label: "belum diisi" }]}
              />
              <FilterSelect
                label="Target" value={fTarget} onChange={setFTarget}
                options={[...LEVEL_URUT.map((l) => ({ value: l, label: l })), { value: "BELUM", label: "belum diisi" }]}
              />
            </div>
            {galat && (
              <p className="text-sm text-destructive">Gagal memuat langkah SOP: {galat}</p>
            )}
            <DataTable
              columns={kolomLangkah}
              data={langkah.rows}
              getKey={(r) => String(r.id)}
              server={{
                totalRows: langkah.total_rows,
                page, pageSize: size, sort: null, q,
                onPageChange: setPage,
                onPageSizeChange: (n) => { setSize(n); setPage(0); },
                onSortChange: () => {},
                onSearchChange: setQ,
                pending: muat,
              }}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="raci" className="space-y-4">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              RACI ber-grain <strong>posisi</strong> dari Tabel A form PIC: R = posisi pelaksana,
              A = PJ. Ini <strong>bukan pengganti</strong> menu <em>RACI Matrix</em> yang
              ber-grain karyawan — keduanya menjawab pertanyaan berbeda. C/I tidak ada di sini;
              sumbernya matriks koordinasi (Tabel C) yang grain-nya pasangan posisi, bukan tugas.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Divisi" value={rDivisi} onChange={setRDivisi} options={divisiOpts} />
            </div>
            {rGalat && <p className="text-sm text-destructive">Gagal memuat RACI: {rGalat}</p>}
            <DataTable
              columns={kolomRaci}
              data={raci.rows}
              getKey={(r) => String(r.tugas_id)}
              server={{
                totalRows: raci.total_rows,
                page: rPage, pageSize: rSize, sort: null, q: rq,
                onPageChange: setRPage,
                onPageSizeChange: (n) => { setRSize(n); setRPage(0); },
                onSortChange: () => {},
                onSearchChange: setRq,
                pending: rMuat,
              }}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="kelengkapan" className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Seberapa lengkap tiap PIC mengisi formnya. Angka rendah di sini adalah{" "}
              <strong>temuan yang perlu ditagih</strong>, bukan kerusakan data. Tanda{" "}
              <span className="text-muted-foreground">—</span> berarti tak ada barisnya sama
              sekali — berbeda arti dari 0% yang berarti barisnya ada tapi kosong semua.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Divisi</th>
                    <th className="py-2 pr-3 font-medium">PIC</th>
                    <th className="py-2 pr-3 text-right font-medium">Posisi</th>
                    <th className="py-2 pr-3 text-right font-medium">Tugas</th>
                    <th className="py-2 pr-3 text-right font-medium">Langkah</th>
                    <th className="py-2 pr-3 text-right font-medium">Koord</th>
                    <th className="py-2 pr-3 text-right font-medium">Obj</th>
                    <th className="py-2 pr-3 text-right font-medium">Tugas ada KPI</th>
                    <th className="py-2 pr-3 text-right font-medium">PJ kanonik</th>
                    <th className="py-2 pr-3 text-right font-medium">Langkah ada target</th>
                    <th className="py-2 text-right font-medium">Dept</th>
                  </tr>
                </thead>
                <tbody>
                  {kelengkapan.map((k) => (
                    <tr key={k.divisi_key} className="border-b last:border-0">
                      <td className="py-2 pr-3">{k.divisi}</td>
                      <td className="py-2 pr-3">{k.pic_nama ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.posisi)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.tugas)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.langkah_sop)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.koordinasi)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmt(k.objective)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(k.pct_tugas_ada_kpi)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(k.pct_pj_kanonik)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pct(k.pct_langkah_ada_target)}</td>
                      <td className="py-2 text-right">
                        {k.terpetakan_ke_department
                          ? <span className="text-muted-foreground">ada</span>
                          : <Badge variant="outline" className="text-[10px]">tanpa pemetaan</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

/** Batang mini untuk sel tabel per-divisi. Penyebutnya `total` langkah divisi
 *  itu, bukan jumlah bucket, supaya "belum diisi" tetap memakan lebar. */
function BatangKecil({ buckets, total }: { buckets: LevelBucket[]; total: number }) {
  if (total === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex h-2 w-32 overflow-hidden rounded bg-muted" role="img"
      aria-label={buckets.filter((b) => b.jumlah > 0).map((b) => `${labelLevel(b.level)} ${b.jumlah}`).join(", ")}>
      {buckets.filter((b) => b.jumlah > 0).map((b) => (
        <div key={labelLevel(b.level)} className={gayaLevel(b.level)}
          style={{ width: `${(b.jumlah / total) * 100}%` }}
          title={`${labelLevel(b.level)}: ${fmt(b.jumlah)}`} />
      ))}
    </div>
  );
}
