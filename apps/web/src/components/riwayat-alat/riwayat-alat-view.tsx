"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { FilterSelect } from "@/components/ui/filter-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pecahSparepart } from "@/lib/riwayat-alat";

// ───────── Tipe (cermin apps/api/src/repo/riwayat-alat.ts) ─────────
interface AlatRow {
  sn_key: string; sn: string | null; alat: string | null; jenis_alat: "KSO" | "Beli" | null;
  kso_asset_id: number | null; installation_unit_id: string | null; faskes: string | null; kota: string | null;
  aktif: boolean | null; kunjungan: number; ganti_sparepart: number; terakhir: string | null; terakhir_jenis: string | null;
}
interface RiwayatRow {
  sumber: "wa" | "form" | "jadwal" | "pm" | "install" | "servis"; ref: string; waktu: string | null;
  jenis: string | null; status: string | null; faskes: string | null; teknisi: string | null; keluhan: string | null;
  kegiatan: string | null; sparepart: string | null; jumlah_tes: number | null; kondisi: string | null;
  catatan: string | null; alat: string | null; sn: string | null;
  /** Foto #REPORT (336): tes = jumlah tes, kondisi = kondisi alat. */
  foto?: { id: number; jenis: "tes" | "kondisi" }[];
}
interface PenempatanRow {
  id: number; faskes: string | null; customerRaw: string; mulai: string | null; selesai: string | null;
  terbuka: boolean; sumber: string; catatan: string | null; tes: number | null;
}
interface Detail { alat: AlatRow; riwayat: RiwayatRow[]; penempatan: PenempatanRow[] }

const SUMBER: Record<RiwayatRow["sumber"], string> = {
  wa: "WA #REPORT", form: "Form lama", jadwal: "Jadwal rutin", pm: "PM & Kalibrasi", install: "Install", servis: "Laporan WA lama",
};

const tgl = (t: string | null) =>
  t ? new Date(`${t.slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";
const strip = (v: string | null | undefined) => (v && v.trim() ? v : "—");

async function ambil<T>(path: string): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  const d = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok) throw new Error(d?.error ?? `Gagal memuat (HTTP ${r.status})`);
  return d as T;
}

/** Muat `path` tiap berubah. Hasil disimpan bersama path-nya; "memuat" = hasil milik path lain. */
function useMuat<T>(path: string | null): { data: T | null; err: string | null } {
  const [hasil, setHasil] = useState<{ path: string; data?: T; err?: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let batal = false;
    ambil<T>(path)
      .then((data) => { if (!batal) setHasil({ path, data }); })
      .catch((e: Error) => { if (!batal) setHasil({ path, err: e.message }); });
    return () => { batal = true; };
  }, [path]);
  if (!path || !hasil || hasil.path !== path) return { data: null, err: null };
  return { data: hasil.data ?? null, err: hasil.err ?? null };
}

const EKSPOR_ALAT: ExportColumn<AlatRow>[] = [
  { header: "SN", value: (r) => r.sn },
  { header: "Alat", value: (r) => r.alat },
  { header: "Jenis", value: (r) => r.jenis_alat ?? "" },
  { header: "Faskes", value: (r) => r.faskes },
  { header: "Kota", value: (r) => r.kota },
  { header: "Jumlah riwayat", value: (r) => r.kunjungan },
  { header: "Ganti sparepart (kali)", value: (r) => r.ganti_sparepart },
  { header: "Terakhir", value: (r) => r.terakhir },
  { header: "Pekerjaan terakhir", value: (r) => r.terakhir_jenis },
];
const EKSPOR_RIWAYAT: ExportColumn<RiwayatRow>[] = [
  { header: "Waktu", value: (r) => r.waktu },
  { header: "Pekerjaan", value: (r) => r.jenis },
  { header: "Faskes", value: (r) => r.faskes },
  { header: "Teknisi", value: (r) => r.teknisi },
  { header: "Keluhan", value: (r) => r.keluhan },
  { header: "Kegiatan", value: (r) => r.kegiatan },
  { header: "Sparepart", value: (r) => r.sparepart },
  { header: "Jumlah tes", value: (r) => r.jumlah_tes },
  { header: "Kondisi alat", value: (r) => r.kondisi },
  { header: "Status", value: (r) => r.status },
  { header: "Catatan", value: (r) => r.catatan },
  { header: "Sumber", value: (r) => SUMBER[r.sumber] },
];

export function RiwayatAlatView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sn = params.get("sn");
  const pilih = useCallback((kunci: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (kunci) q.set("sn", kunci); else q.delete("sn");
    router.push(`${pathname}${q.toString() ? `?${q.toString()}` : ""}`, { scroll: true });
  }, [params, pathname, router]);

  if (sn) return <DetailAlat kunci={sn} kembali={() => pilih(null)} />;
  return (
    <Tabs defaultValue="daftar" className="space-y-4">
      <TabsList>
        <TabsTrigger value="daftar">Daftar alat</TabsTrigger>
        <TabsTrigger value="idle">Alat siap pasang</TabsTrigger>
      </TabsList>
      <TabsContent value="daftar"><DaftarAlat pilih={pilih} /></TabsContent>
      <TabsContent value="idle"><AlatSiapPasang pilih={pilih} /></TabsContent>
    </Tabs>
  );
}

// ───────── Alat siap pasang (idle) — 18 Nov 2026 ─────────
interface AlatIdleRow {
  kunci: string; sn_key: string | null; sn: string | null; nomor_aset: string | null; alat: string | null; lokasi: string | null;
  kategori: "ditarik" | "gudang" | "stok_kantor" | "backup" | "not_ready" | "perlu_cek" | "belum_tertaut";
  tgl_perolehan: string | null; kso_asset_id: number | null;
  riwayat_terakhir: string | null; riwayat_terakhir_jenis: string | null; riwayat_terakhir_faskes: string | null;
}
const KATEGORI_IDLE: Record<AlatIdleRow["kategori"], { label: string; ket: string }> = {
  ditarik: { label: "Ditarik", ket: "pekerjaan terakhir Tarik Alat, belum dipasang lagi" },
  gudang: { label: "Di gudang", ket: "lokasi Accurate: gudang" },
  stok_kantor: { label: "Stok kantor", ket: "Daftar Alat: stok kantor" },
  backup: { label: "Backup", ket: "Daftar Alat: alat backup" },
  not_ready: { label: "Belum siap", ket: "Daftar Alat: not ready" },
  perlu_cek: { label: "Perlu cek", ket: "Daftar Alat: status perlu dicek" },
  belum_tertaut: { label: "Belum tertaut", ket: "aset Accurate belum tertaut ke alat KSO & tak ada kunjungan 12 bulan" },
};
const EKSPOR_IDLE: ExportColumn<AlatIdleRow>[] = [
  { header: "Status", value: (r) => KATEGORI_IDLE[r.kategori].label },
  { header: "Alat", value: (r) => r.alat },
  { header: "SN", value: (r) => r.sn },
  { header: "Nomor aset", value: (r) => r.nomor_aset },
  { header: "Lokasi", value: (r) => r.lokasi },
  { header: "Tanggal perolehan", value: (r) => r.tgl_perolehan },
  { header: "Pekerjaan terakhir", value: (r) => r.riwayat_terakhir_jenis },
  { header: "Tanggal terakhir", value: (r) => r.riwayat_terakhir },
  { header: "Faskes terakhir", value: (r) => r.riwayat_terakhir_faskes },
];

function AlatSiapPasang({ pilih }: { pilih: (kunci: string) => void }) {
  const { data, err } = useMuat<{ rows: AlatIdleRow[] }>("/api/riwayat-alat/idle");
  const [kat, setKat] = useState("");
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => (kat ? r.kategori === kat : r.kategori !== "belum_tertaut")), [data, kat]);
  const jumlah = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rows ?? []) m.set(r.kategori, (m.get(r.kategori) ?? 0) + 1);
    return m;
  }, [data]);
  const kolom: DataColumn<AlatIdleRow>[] = [
    { id: "alat", header: "Alat", accessor: (r) => `${r.alat ?? ""} ${r.sn ?? ""} ${r.nomor_aset ?? ""}`, cell: (r) => (
      <div><div className="font-medium">{r.alat ?? "—"}</div>
        <div className="text-muted-foreground text-xs"><span className="font-mono">{r.sn ?? "tanpa SN"}</span>{r.nomor_aset ? ` · ${r.nomor_aset}` : ""}</div></div>) },
    { id: "kategori", header: "Status", accessor: (r) => KATEGORI_IDLE[r.kategori].label, cell: (r) => (
      <Badge variant={r.kategori === "belum_tertaut" ? "outline" : "secondary"} title={KATEGORI_IDLE[r.kategori].ket}>{KATEGORI_IDLE[r.kategori].label}</Badge>) },
    { id: "lokasi", header: "Lokasi", accessor: (r) => r.lokasi, cell: (r) => <span className="text-sm">{strip(r.lokasi)}</span> },
    { id: "terakhir", header: "Pekerjaan terakhir", accessor: (r) => r.riwayat_terakhir ?? "", searchable: false, cell: (r) => (r.riwayat_terakhir
      ? <span className="text-xs">{tgl(r.riwayat_terakhir)} · {r.riwayat_terakhir_jenis ?? "—"}<span className="text-muted-foreground block">{r.riwayat_terakhir_faskes ?? ""}</span></span>
      : <span className="text-muted-foreground text-xs">—</span>) },
    { id: "perolehan", header: "Perolehan", accessor: (r) => r.tgl_perolehan ?? "", searchable: false, cell: (r) => <span className="text-xs tabular-nums">{tgl(r.tgl_perolehan)}</span> },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Alat siap pasang</CardTitle></CardHeader>
      <CardContent>
        {err ? <EmptyState title="Gagal memuat" description={err} /> : !data ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Memuat…</p>
        ) : (
          <DataTable columns={kolom} data={rows} getKey={(r) => r.kunci} pageSize={10}
            searchPlaceholder="Cari alat / SN / nomor aset / lokasi…"
            onRowClick={(r) => { if (r.sn_key) pilih(r.sn_key); }}
            toolbar={<div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Status" value={kat} onChange={setKat} semua="Semua (kecuali belum tertaut)"
                options={(Object.keys(KATEGORI_IDLE) as AlatIdleRow["kategori"][]).map((k) => ({ value: k, label: `${KATEGORI_IDLE[k].label} (${jumlah.get(k) ?? 0})` }))} />
              <ExportButton filename="alat-siap-pasang" columns={EKSPOR_IDLE} data={rows} />
            </div>}
            empty="Tidak ada alat dengan status ini." />
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          Alat milik WRG (aset KSO di Accurate, dicatat Accounting) yang belum terpasang di customer. <b>Ditarik</b> = pekerjaan terakhirnya Tarik Alat;
          <b> Di gudang</b> = lokasi Accurate gudang; Stok kantor / Backup / Belum siap / Perlu cek = status Daftar Alat. <b>Belum tertaut</b> = aset Accurate
          yang belum tertaut ke alat KSO dan tak ada kunjungan teknisi 12 bulan — bisa jadi idle, bisa jadi datanya belum dirapikan (tautkan di menu Aset Tetap).
          Klik baris untuk melihat riwayat alat.
        </p>
      </CardContent>
    </Card>
  );
}

function DaftarAlat({ pilih }: { pilih: (kunci: string) => void }) {
  const { data, err } = useMuat<{ rows: AlatRow[] }>("/api/riwayat-alat");
  const [jenis, setJenis] = useState("");
  const tampil = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!jenis) return rows;
    return rows.filter((r) => (jenis === "lain" ? r.jenis_alat == null : r.jenis_alat === jenis));
  }, [data, jenis]);

  const kolom: DataColumn<AlatRow>[] = [
    { id: "sn", header: "SN", accessor: (r) => r.sn ?? r.sn_key, cell: (r) => <span className="font-mono text-xs">{r.sn ?? r.sn_key}</span> },
    { id: "alat", header: "Alat", accessor: (r) => r.alat },
    {
      id: "jenis", header: "Jenis", accessor: (r) => r.jenis_alat ?? "",
      cell: (r) => (r.jenis_alat ? <Badge variant={r.jenis_alat === "KSO" ? "default" : "secondary"}>{r.jenis_alat}</Badge> : <span className="text-muted-foreground text-xs">dari riwayat</span>),
    },
    {
      id: "faskes", header: "Faskes", accessor: (r) => r.faskes,
      cell: (r) => (
        <span>{strip(r.faskes)}{r.aktif === false && <span className="text-muted-foreground ml-1 text-xs">(ditarik)</span>}</span>
      ),
    },
    { id: "kota", header: "Kota", accessor: (r) => r.kota },
    { id: "kunjungan", header: "Riwayat", align: "right", accessor: (r) => r.kunjungan, searchable: false },
    { id: "sparepart", header: "Ganti sparepart", align: "right", accessor: (r) => r.ganti_sparepart, searchable: false,
      cell: (r) => (r.ganti_sparepart ? <span className="tabular-nums">{r.ganti_sparepart}×</span> : <span className="text-muted-foreground">—</span>) },
    {
      id: "terakhir", header: "Terakhir", accessor: (r) => r.terakhir ?? "", searchable: false,
      cell: (r) => (r.terakhir ? <span>{tgl(r.terakhir)}<span className="text-muted-foreground block text-xs">{r.terakhir_jenis}</span></span> : "—"),
    },
  ];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Daftar alat</CardTitle></CardHeader>
      <CardContent>
        {err ? <EmptyState title="Gagal memuat" description={err} /> : !data ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Memuat…</p>
        ) : (
          <DataTable columns={kolom} data={tampil} getKey={(r) => r.sn_key} pageSize={10}
            initialSort={{ id: "terakhir", dir: "desc" }} searchPlaceholder="Cari SN / nama alat / faskes / kota…"
            onRowClick={(r) => pilih(r.sn_key)}
            toolbar={<div className="flex flex-wrap items-center gap-3">
              <FilterSelect label="Jenis" value={jenis} onChange={setJenis} semua="Semua alat"
                options={[{ value: "KSO", label: "KSO" }, { value: "Beli", label: "Beli" }, { value: "lain", label: "Hanya dari riwayat" }]} />
              <ExportButton filename="riwayat-alat_daftar" columns={EKSPOR_ALAT} data={tampil} />
            </div>}
            empty="Tidak ada alat." />
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          Klik baris untuk melihat riwayat alat. &quot;Dari riwayat&quot; = SN yang tercatat di laporan teknisi tapi belum ada di master alat.
        </p>
      </CardContent>
    </Card>
  );
}

function DetailAlat({ kunci, kembali }: { kunci: string; kembali: () => void }) {
  const { data, err } = useMuat<Detail>(`/api/riwayat-alat/${encodeURIComponent(kunci)}`);
  const [pekerjaan, setPekerjaan] = useState("");
  const daftarPekerjaan = useMemo(
    () => [...new Set((data?.riwayat ?? []).map((r) => r.jenis).filter((x): x is string => !!x))].sort(),
    [data],
  );
  const riwayat = useMemo(
    () => (data?.riwayat ?? []).filter((r) => !pekerjaan || r.jenis === pekerjaan),
    [data, pekerjaan],
  );

  const kolom: DataColumn<RiwayatRow>[] = [
    {
      id: "waktu", header: "Tanggal", accessor: (r) => r.waktu ?? "", searchable: false,
      cell: (r) => <span className="whitespace-nowrap">{tgl(r.waktu)}</span>,
    },
    { id: "jenis", header: "Pekerjaan", accessor: (r) => r.jenis, cell: (r) => <span className="whitespace-nowrap font-medium">{strip(r.jenis)}</span> },
    { id: "faskes", header: "Faskes", accessor: (r) => r.faskes, className: "min-w-40" },
    { id: "teknisi", header: "Teknisi", accessor: (r) => r.teknisi },
    {
      id: "isi", header: "Keluhan & kegiatan", accessor: (r) => [r.keluhan, r.kegiatan, r.sparepart, r.catatan].filter(Boolean).join(" "),
      sortable: false, className: "min-w-72",
      cell: (r) => (
        <div className="space-y-1 text-xs whitespace-pre-line">
          {r.keluhan && <p><span className="text-muted-foreground">Keluhan: </span>{r.keluhan}</p>}
          {r.kegiatan && <p><span className="text-muted-foreground">Kegiatan: </span>{r.kegiatan}</p>}
          {r.sparepart && <p><span className="text-muted-foreground">Sparepart: </span>{r.sparepart}</p>}
          {r.catatan && <p><span className="text-muted-foreground">Catatan: </span>{r.catatan}</p>}
          {!r.keluhan && !r.kegiatan && !r.sparepart && !r.catatan && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      id: "status", header: "Status / kondisi", accessor: (r) => [r.status, r.kondisi].filter(Boolean).join(" "),
      cell: (r) => (
        <div className="text-xs">
          {r.status && <p>{r.status}</p>}
          {r.kondisi && <p className="text-muted-foreground">{r.kondisi}</p>}
          {r.jumlah_tes != null && <p className="text-muted-foreground">{r.jumlah_tes.toLocaleString("id-ID")} tes/bln</p>}
          {!r.status && !r.kondisi && r.jumlah_tes == null && "—"}
        </div>
      ),
    },
    { id: "foto", header: "Foto", sortable: false, searchable: false, accessor: (r) => r.foto?.length ?? 0, cell: (r) => <FotoLaporan foto={r.foto ?? []} /> },
    { id: "sumber", header: "Sumber", accessor: (r) => SUMBER[r.sumber], cell: (r) => <Badge variant="outline">{SUMBER[r.sumber]}</Badge> },
  ];

  const a = data?.alat;
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={kembali}><ArrowLeft className="mr-1 h-4 w-4" />Daftar alat</Button>
      {err ? <EmptyState title="Gagal memuat" description={err} /> : !data || !a ? (
        <p className="text-muted-foreground py-8 text-center text-sm">Memuat…</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">{a.alat ?? "Alat"} <span className="font-mono text-sm text-muted-foreground">· SN {a.sn ?? a.sn_key}</span></CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                <div><dt className="text-muted-foreground text-xs">Jenis</dt><dd>{a.jenis_alat ?? "Hanya dari riwayat"}{a.aktif === false ? " (ditarik)" : ""}</dd></div>
                <div><dt className="text-muted-foreground text-xs">{a.jenis_alat ? "Faskes sekarang" : "Faskes terakhir"}</dt><dd>{strip(a.faskes)}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Kota</dt><dd>{strip(a.kota)}</dd></div>
                <div><dt className="text-muted-foreground text-xs">Riwayat</dt><dd>{a.kunjungan} kejadian{a.terakhir ? ` · terakhir ${tgl(a.terakhir)}` : ""}</dd></div>
              </dl>
            </CardContent>
          </Card>

          {data.penempatan.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Riwayat penempatan</CardTitle></CardHeader>
              <CardContent>
                <DataTable columns={KOLOM_PENEMPATAN} data={data.penempatan} getKey={(r) => String(r.id)} pageSize={10}
                  initialSort={{ id: "mulai", dir: "desc" }} searchPlaceholder="Cari faskes…" empty="Belum ada penempatan." />
              </CardContent>
            </Card>
          )}

          <RiwayatSparepart riwayat={data.riwayat} kunci={a.sn_key} />

          <Card>
            <CardHeader><CardTitle className="text-base">Riwayat pekerjaan</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={kolom} data={riwayat} getKey={(r) => r.ref} pageSize={10}
                initialSort={{ id: "waktu", dir: "desc" }} searchPlaceholder="Cari keluhan / kegiatan / sparepart / teknisi…"
                toolbar={<div className="flex flex-wrap items-center gap-3">
                  <FilterSelect label="Pekerjaan" value={pekerjaan} onChange={setPekerjaan} semua="Semua pekerjaan"
                    options={daftarPekerjaan.map((j) => ({ value: j, label: j }))} />
                  <ExportButton filename={`riwayat-alat_${a.sn_key}`} columns={EKSPOR_RIWAYAT} data={riwayat} />
                </div>}
                empty="Belum ada riwayat pekerjaan untuk alat ini." />
              <p className="text-muted-foreground mt-2 text-xs">
                Faskes = lokasi alat saat pekerjaan itu. &quot;Form lama&quot; = Google Form Kegiatan Teknisi; &quot;WA #REPORT&quot; = laporan teknisi lewat WA.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

interface BarisSparepart { ref: string; waktu: string | null; item: string[]; jenis: string | null; faskes: string | null; teknisi: string | null; sumber: RiwayatRow["sumber"] }

/** Riwayat penggantian sparepart satu alat (dari #REPORT & Google Form lama), terbaru dulu. */
function RiwayatSparepart({ riwayat, kunci }: { riwayat: RiwayatRow[]; kunci: string }) {
  const rows = useMemo<BarisSparepart[]>(() => riwayat
    .map((r) => ({ ref: r.ref, waktu: r.waktu, item: pecahSparepart(r.sparepart), jenis: r.jenis, faskes: r.faskes, teknisi: r.teknisi, sumber: r.sumber }))
    .filter((r) => r.item.length > 0), [riwayat]);
  const kolom: DataColumn<BarisSparepart>[] = [
    { id: "waktu", header: "Tanggal", accessor: (r) => r.waktu ?? "", searchable: false, cell: (r) => <span className="whitespace-nowrap">{tgl(r.waktu)}</span> },
    { id: "item", header: "Sparepart diganti", accessor: (r) => r.item.join(" "), sortable: false, className: "min-w-64", cell: (r) => (
      <ul className="list-disc space-y-0.5 pl-4 text-sm">{r.item.map((x, i) => <li key={i}>{x}</li>)}</ul>) },
    { id: "jenis", header: "Pekerjaan", accessor: (r) => r.jenis, cell: (r) => strip(r.jenis) },
    { id: "faskes", header: "Faskes", accessor: (r) => r.faskes, className: "min-w-40" },
    { id: "teknisi", header: "Teknisi", accessor: (r) => r.teknisi },
    { id: "sumber", header: "Sumber", accessor: (r) => SUMBER[r.sumber], cell: (r) => <Badge variant="outline">{SUMBER[r.sumber]}</Badge> },
  ];
  const ekspor: ExportColumn<BarisSparepart>[] = [
    { header: "Tanggal", value: (r) => r.waktu },
    { header: "Sparepart diganti", value: (r) => r.item.join("; ") },
    { header: "Pekerjaan", value: (r) => r.jenis },
    { header: "Faskes", value: (r) => r.faskes },
    { header: "Teknisi", value: (r) => r.teknisi },
    { header: "Sumber", value: (r) => SUMBER[r.sumber] },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Riwayat penggantian sparepart <span className="text-muted-foreground text-sm font-normal">· {rows.length}×</span></CardTitle></CardHeader>
      <CardContent>
        <DataTable columns={kolom} data={rows} getKey={(r) => r.ref} pageSize={10} initialSort={{ id: "waktu", dir: "desc" }}
          searchPlaceholder="Cari nama sparepart / teknisi / faskes…"
          toolbar={<ExportButton filename={`sparepart-alat_${kunci}`} columns={ekspor} data={rows} />}
          empty="Belum ada penggantian sparepart tercatat untuk alat ini." />
        <p className="text-muted-foreground mt-2 text-xs">Dari isian Pergantian Sparepart di #REPORT teknisi dan Google Form lama. Bon Sparepart tidak ikut — bon belum tertaut ke alat (SN).</p>
      </CardContent>
    </Card>
  );
}

/** Foto jumlah tes & kondisi alat dari #REPORT — klik untuk ukuran penuh (tab baru). */
function FotoLaporan({ foto }: { foto: { id: number; jenis: "tes" | "kondisi" }[] }) {
  if (!foto.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex max-w-56 flex-wrap gap-1">
      {foto.map((f) => (
        <a key={f.id} href={`/api/riwayat-alat/foto/${f.id}`} target="_blank" rel="noreferrer" title={f.jenis === "tes" ? "Foto jumlah tes" : "Foto kondisi alat"}
          className="relative block">
          {/* eslint-disable-next-line @next/next/no-img-element -- foto dari BFF ber-gerbang, bukan aset statis */}
          <img src={`/api/riwayat-alat/foto/${f.id}`} alt={f.jenis === "tes" ? "Foto jumlah tes" : "Foto kondisi alat"} loading="lazy"
            className="h-12 w-12 rounded border object-cover" />
          <span className="bg-background/90 absolute bottom-0 left-0 rounded-tr px-1 text-[10px] font-medium">{f.jenis === "tes" ? "Tes" : "Kondisi"}</span>
        </a>
      ))}
    </div>
  );
}

const KOLOM_PENEMPATAN: DataColumn<PenempatanRow>[] = [
  { id: "faskes", header: "Faskes", accessor: (r) => r.faskes ?? r.customerRaw },
  { id: "mulai", header: "Mulai", accessor: (r) => r.mulai ?? "", cell: (r) => (r.mulai ? tgl(r.mulai) : "sejak awal tercatat"), searchable: false },
  {
    id: "selesai", header: "Sampai", accessor: (r) => r.selesai ?? "9999", searchable: false,
    cell: (r) => (r.terbuka ? <Badge variant="secondary">masih di sini</Badge> : tgl(r.selesai)),
  },
  { id: "catatan", header: "Catatan", accessor: (r) => r.catatan, cell: (r) => <span className="text-xs">{strip(r.catatan)}</span> },
];
