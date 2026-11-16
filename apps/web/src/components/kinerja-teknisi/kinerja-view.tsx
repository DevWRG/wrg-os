"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangeToolbar } from "@/components/ui/date-range-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filter-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ───────── Tipe (cermin apps/api/src/repo/kinerja-teknisi.ts) ─────────
interface Teknisi { am_id: string; nama: string; aktif: boolean }
interface JadwalRow {
  tanggal: string; jenis: string; teknisi_id: string | null; teknisi_nama: string | null;
  faskes: string | null; alat: string | null; status: string; terlambat: boolean; ref_id: string;
}
interface KerjaRow {
  plan_item_id: number; teknisi_id: string; teknisi_nama: string | null; tanggal: string; urut: number; jenis: string;
  faskes: string | null; di_luar_plan: boolean; plan_telat: boolean; started_at: string | null; selesai_at: string | null;
  status_report: string | null; durasi_menit: number | null; report_tanpa_start: boolean; start_tanpa_report: boolean;
  tanpa_laporan: boolean; berlokasi: boolean; lokasi_alamat: string | null; jumlah_foto: number;
  sla_respon_menit: number | null; sla_selesai_menit: number | null; lewat_eta: boolean | null;
}
interface Ringkasan {
  teknisi_id: string; teknisi_nama: string | null; pekerjaan: number; di_luar_plan: number; dimulai: number;
  dilaporkan: number; selesai: number; report_tanpa_start: number; start_tanpa_report: number; tanpa_laporan: number;
  hari_plan_telat: number; report_berlokasi: number; rata_durasi_menit: number | null; tiket: number;
  rata_sla_respon_menit: number | null; rata_sla_selesai_menit: number | null; lewat_eta: number;
}

// ───────── Format ─────────
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function awalMinggu(): string {
  const n = new Date();
  const geser = (n.getDay() + 6) % 7; // Senin = 0
  return ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() - geser));
}
const tglId = (t: string) =>
  new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
const jam = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "—";
export function durasi(menit: number | null | undefined): string {
  if (menit == null) return "—";
  const j = Math.floor(menit / 60);
  const m = Math.round(menit % 60);
  return j > 0 ? `${j} j ${m} m` : `${m} m`;
}

async function ambil<T>(path: string): Promise<T> {
  const r = await fetch(`/api/kinerja-teknisi/${path}`, { cache: "no-store" });
  const d = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok) throw new Error(d?.error ?? `Gagal memuat (HTTP ${r.status})`);
  return d as T;
}

/** Muat `path` tiap query berubah. Hasil disimpan bersama query-nya; "memuat" = hasil milik query lain. */
function useMuat<T>(path: string): { data: T | null; err: string | null } {
  const [hasil, setHasil] = useState<{ path: string; data?: T; err?: string } | null>(null);
  useEffect(() => {
    let batal = false;
    ambil<T>(path)
      .then((data) => { if (!batal) setHasil({ path, data }); })
      .catch((e: Error) => { if (!batal) setHasil({ path, err: e.message }); });
    return () => { batal = true; };
  }, [path]);
  if (!hasil || hasil.path !== path) return { data: null, err: null };
  return { data: hasil.data ?? null, err: hasil.err ?? null };
}

const TAB_JADWAL = "jadwal";
const TAB_KERJA = "kerja";

export function KinerjaTeknisiView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === TAB_KERJA ? TAB_KERJA : TAB_JADWAL;
  const pindahTab = useCallback((v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v === TAB_JADWAL) q.delete("tab"); else q.set("tab", v);
    router.replace(q.toString() ? `${pathname}?${q.toString()}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const [teknisiList, setTeknisiList] = useState<Teknisi[]>([]);
  const [semua, setSemua] = useState(false);
  const [siap, setSiap] = useState(false);
  const [teknisi, setTeknisi] = useState("");
  const [dari, setDari] = useState(awalMinggu);
  const [sampai, setSampai] = useState(() => ymd(new Date()));

  useEffect(() => {
    ambil<{ semua: boolean; rows: Teknisi[] }>("teknisi")
      .then((d) => { setTeknisiList(d.rows); setSemua(d.semua); })
      .catch(() => setTeknisiList([]))
      .finally(() => setSiap(true));
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams({ dari, sampai });
    if (teknisi) q.set("teknisi", teknisi);
    return q.toString();
  }, [dari, sampai, teknisi]);

  const filter = (
    <div className="flex flex-wrap items-center gap-3">
      {semua && (
        <FilterSelect label="Teknisi" value={teknisi} onChange={setTeknisi} semua="Semua teknisi"
          options={teknisiList.map((t) => ({ value: t.am_id, label: t.aktif ? t.nama : `${t.nama} (nonaktif)` }))} />
      )}
      <DateRangeToolbar from={dari} to={sampai} onFrom={setDari} onTo={setSampai} idPrefix="kt" />
    </div>
  );

  if (!siap) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  if (!semua && teknisiList.length === 0) {
    return (
      <EmptyState
        title="Akun Anda belum tertaut ke data teknisi"
        description="Minta admin menautkan akun ke data karyawan (role Teknisi) di menu Users, atau beri izin 'Kinerja Teknisi — lihat semua teknisi'."
      />
    );
  }

  return (
    <Tabs value={tab} onValueChange={(v) => pindahTab(String(v))} className="gap-4">
      <TabsList className="max-w-full justify-start overflow-x-auto">
        <TabsTrigger value={TAB_JADWAL}>Jadwal</TabsTrigger>
        <TabsTrigger value={TAB_KERJA}>Plan &amp; Report</TabsTrigger>
      </TabsList>
      <TabsContent value={TAB_JADWAL}><TabJadwal query={query} filter={filter} dari={dari} /></TabsContent>
      <TabsContent value={TAB_KERJA}><TabKerja query={query} filter={filter} /></TabsContent>
    </Tabs>
  );
}

// ───────── Tab Jadwal ─────────
// Aturan (keputusan user 16 Nov 2026):
//   - tabel = jadwal DALAM rentang yang dipilih; urut default per teknisi lalu tanggal;
//   - tunggakan (tanggal sebelum rentang, masih terbuka) DISEMBUNYIKAN — tombol "Tunggakan (n)"
//     menampilkannya; API tetap mengirimnya supaya jumlahnya selalu terlihat.
//   - "lewat" (merah) = tanggal sebelum hari ini dan belum selesai.
function TabJadwal({ query, filter, dari }: { query: string; filter: ReactNode; dari: string }) {
  const { data, err } = useMuat<{ rows: JadwalRow[] }>(`jadwal?${query}`);
  const [lihatTunggakan, setLihatTunggakan] = useState(false);
  const rows = data?.rows ?? null;
  const tunggakan = rows ? rows.filter((r) => r.tanggal < dari).length : 0;
  const tampil = rows ? (lihatTunggakan ? rows : rows.filter((r) => r.tanggal >= dari)) : null;

  const kolom: DataColumn<JadwalRow>[] = [
    // Kunci sortir teknisi menyertakan tanggal → "per teknisi, lalu tanggal"; belum ditugaskan di akhir.
    { id: "teknisi", header: "Teknisi", sortable: true, accessor: (r) => `${r.teknisi_nama ?? "\uffff"}|${r.tanggal}|${r.jenis}`,
      cell: (r) => r.teknisi_nama ?? <span className="text-muted-foreground">belum ditugaskan</span> },
    { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => r.tanggal,
      cell: (r) => (
        <span className={r.terlambat ? "font-semibold text-destructive" : ""}>
          {tglId(r.tanggal)}{r.terlambat ? " · lewat" : ""}
        </span>
      ) },
    { id: "jenis", header: "Jenis", sortable: true, accessor: (r) => r.jenis, cell: (r) => <Badge variant="outline">{r.jenis}</Badge> },
    { id: "faskes", header: "Faskes", accessor: (r) => r.faskes ?? "", cell: (r) => r.faskes ?? "—" },
    { id: "alat", header: "Alat / keluhan", accessor: (r) => r.alat ?? "", cell: (r) => <span className="text-muted-foreground">{r.alat ?? "—"}</span> },
    { id: "status", header: "Status", accessor: (r) => r.status },
  ];

  if (err) return <p role="alert" className="text-destructive text-sm">{err}</p>;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {filter}
      <Button size="sm" variant={lihatTunggakan ? "default" : "outline"} disabled={tunggakan === 0}
        onClick={() => setLihatTunggakan((v) => !v)} aria-pressed={lihatTunggakan}
        title="Jadwal sebelum rentang yang dipilih dan belum selesai">
        {lihatTunggakan ? "Sembunyikan tunggakan" : `Tunggakan (${tunggakan})`}
      </Button>
    </div>
  );
  return tampil === null ? <p className="text-muted-foreground text-sm">Memuat…</p> : (
    <DataTable columns={kolom} data={tampil} getKey={(r) => `${r.jenis}-${r.ref_id}`} pageSize={20}
      initialSort={{ id: "teknisi", dir: "asc" }} searchPlaceholder="Cari teknisi / faskes / alat…" toolbar={toolbar}
      empty={lihatTunggakan ? "Tidak ada jadwal." : "Tidak ada jadwal di rentang ini."} />
  );
}

// ───────── Tab Plan & Report ─────────
function TabKerja({ query, filter }: { query: string; filter: ReactNode }) {
  const { data, err } = useMuat<{ rows: KerjaRow[]; ringkasan: Ringkasan[] }>(`kerja?${query}`);

  const kolomRingkas: DataColumn<Ringkasan>[] = [
    { id: "nama", header: "Teknisi", sortable: true, accessor: (r) => r.teknisi_nama ?? r.teknisi_id },
    { id: "pekerjaan", header: "Pekerjaan", sortable: true, accessor: (r) => r.pekerjaan, className: "text-right tabular-nums",
      cell: (r) => <>{r.pekerjaan}{r.di_luar_plan ? <span className="text-muted-foreground"> (+{r.di_luar_plan} di luar plan)</span> : null}</> },
    { id: "lapor", header: "Start / Report", accessor: (r) => r.dilaporkan, className: "tabular-nums",
      cell: (r) => `${r.dimulai} / ${r.dilaporkan}` },
    { id: "durasi", header: "Rata waktu kerja", sortable: true, accessor: (r) => r.rata_durasi_menit ?? -1, className: "tabular-nums",
      cell: (r) => durasi(r.rata_durasi_menit) },
    { id: "sla", header: "SLA tiket (respon / selesai)", accessor: (r) => r.rata_sla_selesai_menit ?? -1, className: "tabular-nums",
      cell: (r) => (r.tiket ? `${durasi(r.rata_sla_respon_menit)} / ${durasi(r.rata_sla_selesai_menit)}` : "—") },
    { id: "eta", header: "Lewat ETA", sortable: true, accessor: (r) => r.lewat_eta, className: "tabular-nums",
      cell: (r) => (r.tiket ? <span className={r.lewat_eta ? "font-semibold text-destructive" : ""}>{r.lewat_eta} / {r.tiket}</span> : "—") },
    { id: "patuh", header: "Kepatuhan", accessor: (r) => r.report_tanpa_start + r.start_tanpa_report + r.tanpa_laporan + r.hari_plan_telat,
      cell: (r) => <Kepatuhan r={r} /> },
  ];

  const kolom: DataColumn<KerjaRow>[] = [
    { id: "tanggal", header: "Tanggal", sortable: true, accessor: (r) => `${r.tanggal}-${String(r.urut).padStart(2, "0")}`,
      cell: (r) => `${tglId(r.tanggal)} · No. ${r.urut}` },
    { id: "teknisi", header: "Teknisi", sortable: true, accessor: (r) => r.teknisi_nama ?? r.teknisi_id },
    { id: "pekerjaan", header: "Pekerjaan", accessor: (r) => `${r.jenis} ${r.faskes ?? ""}`,
      cell: (r) => (
        <div>
          <Badge variant="outline">{r.jenis}</Badge> <span>{r.faskes ?? "—"}</span>
          {r.di_luar_plan && <span className="text-muted-foreground text-xs"> · di luar plan</span>}
        </div>
      ) },
    { id: "waktu", header: "Start → Report", accessor: (r) => r.started_at ?? "", className: "tabular-nums",
      cell: (r) => `${jam(r.started_at)} → ${jam(r.selesai_at)}` },
    { id: "durasi", header: "Waktu kerja", sortable: true, accessor: (r) => r.durasi_menit ?? -1, className: "tabular-nums",
      cell: (r) => durasi(r.durasi_menit) },
    { id: "sla", header: "SLA tiket", accessor: (r) => r.sla_selesai_menit ?? -1, className: "tabular-nums",
      cell: (r) => (r.lewat_eta == null && r.sla_selesai_menit == null ? "—" : (
        <span className={r.lewat_eta ? "font-semibold text-destructive" : ""}>
          {durasi(r.sla_respon_menit)} / {durasi(r.sla_selesai_menit)}{r.lewat_eta ? " · lewat ETA" : ""}
        </span>
      )) },
    { id: "status", header: "Status", accessor: (r) => r.status_report ?? "", cell: (r) => r.status_report ?? "—" },
    { id: "lokasi", header: "Lokasi", accessor: (r) => (r.berlokasi ? 1 : 0),
      cell: (r) => (r.selesai_at == null ? "—" : r.berlokasi
        ? <span title={r.lokasi_alamat ?? undefined}>📍 ada</span>
        : <span className="text-amber-600">{r.jumlah_foto ? "foto tanpa geotag" : "tanpa foto"}</span>) },
    { id: "tanda", header: "Tanda", accessor: () => "", cell: (r) => <TandaKerja r={r} /> },
  ];

  if (err) return <p role="alert" className="text-destructive text-sm">{err}</p>;
  if (!data) return <p className="text-muted-foreground text-sm">Memuat…</p>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Ringkasan per teknisi</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={kolomRingkas} data={data.ringkasan} getKey={(r) => r.teknisi_id} pageSize={10}
            initialSort={{ id: "nama", dir: "asc" }} searchPlaceholder="Cari teknisi…" toolbar={filter}
            empty="Belum ada #PLAN/#REPORT teknisi di rentang ini." />
          <p className="text-muted-foreground mt-2 text-xs">
            Waktu kerja = jam #REPORT − jam #START. SLA tiket = tiket masuk → #START (respon) dan → #REPORT (selesai);
            &quot;lewat ETA&quot; = selesai melewati ETA tiket.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Detail pekerjaan</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={kolom} data={data.rows} getKey={(r) => String(r.plan_item_id)} pageSize={20}
            initialSort={{ id: "tanggal", dir: "desc" }} searchPlaceholder="Cari teknisi / faskes…"
            empty="Belum ada pekerjaan di rentang ini." />
        </CardContent>
      </Card>
    </div>
  );
}

function Kepatuhan({ r }: { r: Ringkasan }) {
  const tanda: string[] = [];
  if (r.hari_plan_telat) tanda.push(`${r.hari_plan_telat} hari plan telat`);
  if (r.report_tanpa_start) tanda.push(`${r.report_tanpa_start} tanpa #START`);
  if (r.start_tanpa_report) tanda.push(`${r.start_tanpa_report} belum #REPORT`);
  if (r.tanpa_laporan) tanda.push(`${r.tanpa_laporan} tanpa laporan`);
  if (r.dilaporkan && r.report_berlokasi < r.dilaporkan) tanda.push(`${r.dilaporkan - r.report_berlokasi} report tanpa lokasi`);
  if (!tanda.length) return <span className="text-emerald-700 dark:text-emerald-400">✓ patuh</span>;
  return <span className="text-amber-700 dark:text-amber-400 text-xs">{tanda.join(" · ")}</span>;
}

function TandaKerja({ r }: { r: KerjaRow }) {
  const t: string[] = [];
  if (r.plan_telat && !r.di_luar_plan) t.push("plan telat");
  if (r.report_tanpa_start) t.push("tanpa #START");
  if (r.start_tanpa_report) t.push("belum #REPORT");
  if (r.tanpa_laporan) t.push("tanpa laporan");
  if (!t.length) return null;
  return <span className="text-amber-700 dark:text-amber-400 text-xs">{t.join(" · ")}</span>;
}
