"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { KontrakDialog } from "./kontrak-dialog";
import { TambahKontrakDialog } from "./tambah-kontrak-dialog";
import {
  BUCKET_CLS, BUCKET_LABEL, STATUS_LABEL, rpC, sisaTeks,
  type Bucket, type DaftarKontrak, type Kelengkapan, type Kontrak, type StatusKontrak,
} from "./types";

const BUCKET_PAPAN: Bucket[] = ["LEWAT", "H30", "H60", "H90", "H120", "AMAN", "TANPA_TANGGAL"];
const URUT: Record<Bucket, number> = { LEWAT: 0, H30: 1, H60: 2, H90: 3, H120: 4, AMAN: 5, TANPA_TANGGAL: 6, SELESAI: 7 };

// F47 Kontrak KSO — papan jatuh tempo + kelengkapan data. Data dari
// apps/api/src/repo/kso-kontrak.ts (status & bucket dihitung di sana).
export function KontrakView({ daftar, kelengkapan, canEdit }: { daftar: DaftarKontrak; kelengkapan: Kelengkapan; canEdit: boolean }) {
  const [tab, setTab] = useState("tempo");
  const [bucket, setBucket] = useState("");
  const [status, setStatus] = useState("");
  const [verif, setVerif] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [tambah, setTambah] = useState<{ open: boolean; akun?: string | null; n: number }>({ open: false, n: 0 });

  const data = useMemo(() => daftar.kontrak.filter((k) =>
    (!bucket || k.bucket === bucket)
    && (!status ? k.status === "AKTIF" || k.status === "NEGO" : status === "SEMUA" || k.status === status)
    && (!verif || (verif === "belum" ? !k.terverifikasi : k.terverifikasi))), [daftar.kontrak, bucket, status, verif]);

  const columns: DataColumn<Kontrak>[] = [
    { id: "akun", header: "Faskes", sortable: true, accessor: (r) => r.account_nama, cell: (r) => (
      <div><div className="font-medium">{r.account_nama}</div><div className="text-muted-foreground text-xs">{r.nomor}</div></div>) },
    { id: "berakhir", header: "Berakhir", sortable: true, accessor: (r) => r.berakhir ?? "9999", cell: (r) => (
      <div><div className="tabular-nums">{r.berakhir ?? "—"}</div><div className="text-muted-foreground text-xs">{sisaTeks(r)}</div></div>) },
    { id: "bucket", header: "Jatuh tempo", sortable: true, accessor: (r) => URUT[r.bucket], cell: (r) => (
      <span className={cn("rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap", BUCKET_CLS[r.bucket])}>{BUCKET_LABEL[r.bucket]}</span>) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => (
      <div className="text-sm">{STATUS_LABEL[r.status]}{!r.terverifikasi && <div className="text-xs text-amber-600 dark:text-amber-500">belum diverifikasi</div>}</div>) },
    { id: "alat", header: "Alat", align: "right", sortable: true, accessor: (r) => r.jumlah_alat },
    { id: "nkt", header: "NKT", align: "right", sortable: true, accessor: (r) => r.nkt ?? -1, cell: (r) => rpC(r.nkt) },
    { id: "am", header: "AM pemilik akun", sortable: true, accessor: (r) => r.owner_nama ?? "", cell: (r) => r.owner_nama ?? <span className="text-muted-foreground">—</span> },
  ];

  const nDraft = kelengkapan.alat_tanpa_kontrak.filter((x) => x.kategori === "draft").length;
  const nAlatTanpa = kelengkapan.alat_tanpa_kontrak.reduce((s, x) => s + x.jumlah_alat, 0);

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="tempo">Jatuh Tempo</TabsTrigger>
            <TabsTrigger value="lengkap">Kelengkapan Data ({kelengkapan.alat_tanpa_kontrak.length + kelengkapan.kontrak_tanpa_tanggal.length + kelengkapan.kontrak_tanggal_beda.length})</TabsTrigger>
          </TabsList>
          {canEdit && <Button size="sm" onClick={() => setTambah({ open: true, n: tambah.n + 1 })}>Tambah kontrak</Button>}
        </div>

        <TabsContent value="tempo" className="space-y-4">
          {daftar.belum_verifikasi > 0 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {daftar.belum_verifikasi} kontrak masih <b>belum diverifikasi</b> — diisi awal dari master alat (sheet), yang tanggal MoU-nya sering tak diperbarui
              setelah perpanjangan. Kontrak “sudah lewat” belum tentu benar-benar habis: buka kontraknya, betulkan tanggalnya, lalu tandai terverifikasi.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {BUCKET_PAPAN.map((b) => (
              <button key={b} type="button" onClick={() => setBucket(bucket === b ? "" : b)}
                className={cn("bg-card rounded-lg border p-3 text-left transition-colors hover:border-primary", bucket === b && "border-primary ring-2 ring-primary/30")}>
                <div className="text-muted-foreground text-xs">{BUCKET_LABEL[b]}</div>
                <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", BUCKET_CLS[b])}>{daftar.ringkasan[b] ?? 0}</div>
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={columns}
                data={data}
                getKey={(r) => r.id}
                searchPlaceholder="Cari faskes / nomor MoU…"
                pageSize={25}
                initialSort={{ id: "bucket", dir: "asc" }}
                onRowClick={(r) => setBuka(r.id)}
                empty="Tidak ada kontrak yang cocok dengan filter."
                toolbar={
                  <div className="flex flex-wrap items-center gap-3">
                    <FilterSelect label="Jatuh tempo" value={bucket} onChange={setBucket}
                      options={[...BUCKET_PAPAN, "SELESAI" as Bucket].map((b) => ({ value: b, label: BUCKET_LABEL[b] }))} />
                    <FilterSelect label="Status" value={status} onChange={setStatus} semua="Aktif & negosiasi"
                      options={[{ value: "SEMUA", label: "Semua status" }, ...(Object.keys(STATUS_LABEL) as StatusKontrak[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
                    <FilterSelect label="Verifikasi" value={verif} onChange={setVerif}
                      options={[{ value: "belum", label: "Belum diverifikasi" }, { value: "sudah", label: "Sudah diverifikasi" }]} />
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lengkap" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Alat KSO operasional tanpa kontrak — {kelengkapan.alat_tanpa_kontrak.length} faskes, {nAlatTanpa} alat</CardTitle>
              <p className="text-muted-foreground text-xs">
                Nomor MoU di sheet kosong atau bukan nomor sungguhan (“-”, “BELUM MOU”). {nDraft} faskes hanya punya MoU berstatus DRAFT — buat kontraknya
                dengan status negosiasi.
              </p>
            </CardHeader>
            <CardContent>
              <DataTable
                data={kelengkapan.alat_tanpa_kontrak}
                getKey={(r) => r.account_id}
                pageSize={10}
                searchPlaceholder="Cari faskes…"
                columns={[
                  { id: "akun", header: "Faskes", sortable: true, accessor: (r) => r.account_nama },
                  { id: "alat", header: "Alat", align: "right", sortable: true, accessor: (r) => r.jumlah_alat },
                  { id: "kat", header: "Di sheet", sortable: true, accessor: (r) => r.kategori, cell: (r) => (
                    <span className="text-sm">{r.kategori === "draft" ? "MoU masih draft" : "Tanpa nomor MoU"}
                      {r.nomor_sheet && <span className="text-muted-foreground block text-xs">{r.nomor_sheet}</span>}</span>) },
                  ...(canEdit ? [{ id: "aksi", header: "", cell: (r: Kelengkapan["alat_tanpa_kontrak"][number]) => (
                    <Button size="sm" variant="soft" onClick={() => setTambah({ open: true, akun: r.account_id, n: tambah.n + 1 })}>Buat kontrak</Button>) }] : []),
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kontrak tanpa tanggal berakhir — {kelengkapan.kontrak_tanpa_tanggal.length}</CardTitle>
              <p className="text-muted-foreground text-xs">Tidak bisa masuk papan jatuh tempo sampai tanggal berakhirnya diisi.</p>
            </CardHeader>
            <CardContent>
              <DataTable data={kelengkapan.kontrak_tanpa_tanggal} getKey={(r) => r.id} pageSize={10} onRowClick={(r) => setBuka(r.id)}
                columns={columns.filter((c) => ["akun", "status", "alat", "am"].includes(c.id))} empty="Semua kontrak aktif sudah bertanggal." />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">MoU dengan tanggal berbeda antar-alat — {kelengkapan.kontrak_tanggal_beda.length}</CardTitle>
              <p className="text-muted-foreground text-xs">Isian awal mengambil tanggal terjauh. Pastikan tanggal yang benar, lalu simpan.</p>
            </CardHeader>
            <CardContent>
              <DataTable data={kelengkapan.kontrak_tanggal_beda} getKey={(r) => r.id} pageSize={10} onRowClick={(r) => setBuka(r.id)}
                columns={[...columns.filter((c) => ["akun", "berakhir"].includes(c.id)),
                  { id: "sheet", header: "Tanggal di sheet", accessor: (r) => r.tanggal_sheet }]}
                empty="Tidak ada." />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* key = remount per kontrak / per pembukaan → state dialog selalu bersih */}
      <KontrakDialog key={buka ?? "tutup"} id={buka} canEdit={canEdit} onClose={() => setBuka(null)} />
      <TambahKontrakDialog key={`tambah-${tambah.n}`} open={tambah.open} akunAwal={tambah.akun} onClose={() => setTambah({ ...tambah, open: false })} />
    </>
  );
}
