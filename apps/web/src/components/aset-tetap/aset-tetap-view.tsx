"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { AsetDialog } from "./aset-dialog";
import { PREFIX_LABEL, ambil, rp, rpC, tgl, type AsetTetapRow, type DaftarAset, type Ringkasan } from "./types";

const STATUS_OPSI = [
  { value: "semua", label: "Semua" },
  { value: "disposed", label: "Dilepas (disposed)" },
  { value: "habis", label: "Habis disusutkan" },
];

// F34 Aset Tetap — cermin register Accurate (read-only) + jadwal depresiasi
// hasil hitung. Data: apps/api/src/repo/asetTetap.ts. Tabel server-paged:
// 1.394 aset, jadi filter/search/sort dikerjakan backend (#tabel-limit).
export function AsetTetapView({ ringkasan, canEdit }: { ringkasan: Ringkasan; canEdit: boolean }) {
  const [prefix, setPrefix] = useState("");
  const [tipe, setTipe] = useState("");
  const [status, setStatus] = useState(""); // "" = aktif (default backend)
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<DaftarAset | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [buka, setBuka] = useState<number | null>(null);
  const [sync, setSync] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  const reqId = useRef(0);

  const muat = useCallback(async () => {
    const id = ++reqId.current;
    setPending(true);
    const qs = new URLSearchParams({ limit: String(size), offset: String(page * size), status: status || "aktif" });
    if (q.trim()) qs.set("q", q.trim());
    if (prefix) qs.set("prefix", prefix);
    if (tipe) qs.set("tipe", tipe);
    if (sort) { qs.set("sort", sort.id); qs.set("dir", sort.dir); }
    try {
      const d = await ambil<DaftarAset>(`/api/aset-tetap?${qs}`);
      if (id === reqId.current) { setData(d); setErr(null); }
    } catch (e) {
      if (id === reqId.current) setErr((e as Error).message);
    } finally {
      if (id === reqId.current) setPending(false);
    }
  }, [size, page, status, q, prefix, tipe, sort]);

  useEffect(() => {
    const t = setTimeout(muat, q ? 300 : 0); // debounce ketikan search
    return () => clearTimeout(t);
  }, [muat, q]);

  const sinkron = async () => {
    setSync({ busy: true, msg: null });
    try {
      await ambil("/api/aset-tetap/sync", { method: "POST" });
      setSync({ busy: false, msg: "Sinkron dimulai di latar (±10 menit). Muat ulang halaman sesudahnya untuk melihat hasil." });
    } catch (e) {
      setSync({ busy: false, msg: `Gagal memulai sinkron: ${(e as Error).message}` });
    }
  };

  const t = ringkasan.total;
  const prefixOpsi = [...new Set(ringkasan.per_kelompok.map((k) => k.prefix).filter((p): p is string => !!p))]
    .map((p) => ({ value: p, label: PREFIX_LABEL[p] ? `${p} · ${PREFIX_LABEL[p]}` : p }));
  const tipeOpsi = ringkasan.tipe.map((x) => ({ value: x, label: x }));

  const columns: DataColumn<AsetTetapRow>[] = [
    { id: "number", header: "Nomor", sortable: true, accessor: (r) => r.number, cell: (r) => (
      <div>
        <div className="font-medium whitespace-nowrap">{r.number}</div>
        <div className="text-muted-foreground max-w-[22rem] truncate text-xs">{r.description ?? "—"}</div>
      </div>) },
    { id: "fa_type_name", header: "Tipe", sortable: true, accessor: (r) => r.fa_type_name ?? "", cell: (r) => (
      <div className="text-sm">
        {r.fa_type_name ?? "—"}
        {r.disposed && <Badge variant="outline" className="ml-1.5">dilepas</Badge>}
      </div>) },
    { id: "trans_date", header: "Tgl Accurate", sortable: true, accessor: (r) => r.trans_date ?? "", cell: (r) => (
      <div className="whitespace-nowrap">
        <div className="tabular-nums">{tgl(r.trans_date)}</div>
        {r.tgl_perolehan_asli && <div className="text-muted-foreground text-xs">asli {tgl(r.tgl_perolehan_asli)}</div>}
      </div>) },
    { id: "current_asset_cost", header: "Nilai perolehan", align: "right", sortable: true, accessor: (r) => r.current_asset_cost ?? 0, cell: (r) => <span className="tabular-nums">{rp(r.current_asset_cost)}</span> },
    { id: "akumulasi", header: "Akumulasi", align: "right", sortable: true, accessor: (r) => r.akumulasi, cell: (r) => <span className="tabular-nums">{rp(r.akumulasi)}</span> },
    { id: "book_value", header: "Nilai buku", align: "right", sortable: true, accessor: (r) => r.book_value ?? 0, cell: (r) => <span className="font-medium tabular-nums">{rp(r.book_value)}</span> },
    { id: "susut_per_bulan", header: "Susut/bln", align: "right", sortable: true, accessor: (r) => r.susut_per_bulan ?? 0, cell: (r) => (
      <span className="tabular-nums">{r.habis_susut ? <span className="text-muted-foreground">habis</span> : rp(r.susut_per_bulan)}</span>) },
    { id: "sisa_bulan", header: "Sisa", align: "right", sortable: true, accessor: (r) => r.sisa_bulan ?? -1, cell: (r) => (
      <span className="tabular-nums">{r.sisa_bulan == null ? "—" : `${r.sisa_bulan} bln`}</span>) },
  ];

  const syncInfo = ringkasan.sync;
  const ringkas = syncInfo.summary as { synced?: number; failed?: number; listed?: number; rowCount?: number | null; error?: string } | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="text-muted-foreground">
          {syncInfo.last_synced_at
            ? <>Sinkron terakhir {new Date(syncInfo.last_synced_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                {" · "}
                {syncInfo.last_run_ok
                  ? <span className="text-success">lengkap</span>
                  : <span className="text-destructive">bermasalah{ringkas?.error ? `: ${ringkas.error}` : ringkas ? ` (${ringkas.synced ?? 0}/${ringkas.rowCount ?? ringkas.listed ?? "?"} tersinkron, ${ringkas.failed ?? 0} gagal)` : ""}</span>}
              </>
            : "Belum pernah disinkron dari Accurate."}
        </div>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={sinkron} disabled={sync.busy}>
            <RefreshCw className="size-4" /> Sinkron dari Accurate
          </Button>
        )}
      </div>
      {sync.msg && <div className="text-sm">{sync.msg}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Nilai perolehan (aktif)" nilai={rpC(t.nilai_perolehan)} sub={`${(t.jumlah - t.disposed).toLocaleString("id-ID")} aset aktif · ${t.disposed} dilepas`} />
        <Kpi label="Akumulasi penyusutan" nilai={rpC(t.akumulasi)} sub="nilai perolehan − nilai buku" />
        <Kpi label="Nilai buku" nilai={rpC(t.nilai_buku)} sub={t.nilai_perolehan > 0 ? `${Math.round((t.nilai_buku / t.nilai_perolehan) * 100)}% dari nilai perolehan` : undefined} />
        <Kpi label="Penyusutan per bulan" nilai={rpC(t.susut_per_bulan)} sub="aset aktif yang belum habis susut" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Per kelompok</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kelompok</TableHead>
                <TableHead>Tipe Accurate</TableHead>
                <TableHead className="text-right">Aset</TableHead>
                <TableHead className="text-right">Dilepas</TableHead>
                <TableHead className="text-right">Habis susut</TableHead>
                <TableHead className="text-right">Nilai perolehan</TableHead>
                <TableHead className="text-right">Nilai buku</TableHead>
                <TableHead className="text-right">Susut/bln</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ringkasan.per_kelompok.map((k) => (
                <TableRow
                  key={`${k.prefix}|${k.fa_type_name}`}
                  className="cursor-pointer"
                  onClick={() => { setPrefix(k.prefix ?? ""); setTipe(k.fa_type_name ?? ""); setPage(0); }}
                >
                  <TableCell className="font-medium">{k.prefix ?? "—"}{k.prefix && PREFIX_LABEL[k.prefix] ? <span className="text-muted-foreground font-normal"> · {PREFIX_LABEL[k.prefix]}</span> : null}</TableCell>
                  <TableCell>{k.fa_type_name ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.jumlah.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.disposed}</TableCell>
                  <TableCell className="text-right tabular-nums">{k.habis_susut}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpC(k.nilai_perolehan)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpC(k.nilai_buku)}</TableCell>
                  <TableCell className="text-right tabular-nums">{rpC(k.susut_per_bulan)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-2 text-xs">Klik baris untuk menyaring daftar di bawah. Nilai uang hanya aset aktif.</p>
        </CardContent>
      </Card>

      {err && <div className="text-destructive text-sm">Gagal memuat daftar: {err}</div>}
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        getKey={(r) => String(r.id)}
        searchPlaceholder="Cari nomor / nama aset…"
        empty={data ? "Tidak ada aset yang cocok." : "Memuat…"}
        onRowClick={(r) => setBuka(r.id)}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Kelompok" value={prefix} onChange={(v) => { setPrefix(v); setPage(0); }} options={prefixOpsi} />
            <FilterSelect label="Tipe" value={tipe} onChange={(v) => { setTipe(v); setPage(0); }} options={tipeOpsi} />
            <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={STATUS_OPSI} semua="Aktif" />
          </div>
        }
        server={{
          totalRows: data?.total_rows ?? 0,
          page,
          pageSize: size,
          sort,
          q,
          pending,
          onPageChange: setPage,
          onPageSizeChange: (n) => { setSize(n); setPage(0); },
          onSortChange: (s) => { setSort(s); setPage(0); },
          onSearchChange: (v) => { setQ(v); setPage(0); },
        }}
      />

      <AsetDialog key={buka ?? "tutup"} id={buka} canEdit={canEdit} onClose={() => setBuka(null)} onSaved={muat} />
    </div>
  );
}

function Kpi({ label, nilai, sub }: { label: string; nilai: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{nilai}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}
