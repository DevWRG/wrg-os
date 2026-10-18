"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccessUser } from "@/lib/cn-access";
import { cn } from "@/lib/utils";

import { DetailDialog, KontrakDialog, PengajuanDialog } from "./dialogs";
import {
  KONTRAK_CLS, STATUS_CLS, STATUS_LABEL, jsonInit, kirim, rupiah, tarifLabel, tglId,
  type CnRow, type CnStatus, type KontrakRow, type LaporanBaris, type Ringkasan,
} from "./types";

// F151 CN (Kredit Note) — tiga tab: Pengajuan (alur), Kontrak (dasar tarif), Laporan (per customer & per sales).
export function CnView({ pengajuan, ringkasan, kontrak, bolehBuat, bolehUbah, bolehKelolaKontrak, pelaku, me }: {
  pengajuan: CnRow[]; ringkasan: Ringkasan; kontrak: KontrakRow[]; bolehBuat: boolean; bolehUbah: boolean;
  bolehKelolaKontrak: boolean; pelaku: string; me: AccessUser;
}) {
  const [status, setStatus] = useState("");
  const [buka, setBuka] = useState<number | null>(null);
  const [ajukan, setAjukan] = useState(false);
  const [kontrakBaru, setKontrakBaru] = useState(false);

  const data = useMemo(() => pengajuan.filter((p) => !status || p.status === status), [pengajuan, status]);
  const berjalan = ringkasan.total - ringkasan.per_status.terealisasi - ringkasan.per_status.ditolak - ringkasan.per_status.dibatalkan;

  const kolomCn: DataColumn<CnRow>[] = [
    { id: "kode", header: "Kode", sortable: true, accessor: (r) => r.kode, cell: (r) => (
      <div><div className="font-medium">{r.kode}</div><div className="text-muted-foreground text-xs">{tglId(r.created_at)} · {r.requested_by ?? "—"}</div></div>) },
    { id: "cust", header: "Customer", sortable: true, accessor: (r) => r.customer_name, cell: (r) => (
      <div><div>{r.customer_name}</div><div className="text-muted-foreground text-xs">{tarifLabel(r.jenis, r.tarif)}</div></div>) },
    { id: "dpp", header: "DPP faktur", align: "right", sortable: true, accessor: (r) => r.total_dpp, searchable: false, cell: (r) => <span className="tabular-nums">{rupiah(r.total_dpp)}</span> },
    { id: "cn", header: "Nilai CN", align: "right", sortable: true, accessor: (r) => r.total_cn, searchable: false, cell: (r) => <span className="font-medium tabular-nums">{rupiah(r.total_cn)}</span> },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["Berjalan", berjalan], ["Menunggu HoD", ringkasan.per_status.diajukan + ringkasan.per_status.ditinjau],
          ["Nilai CN berjalan", rupiah(ringkasan.total_cn_berjalan)], ["Nilai CN terealisasi", rupiah(ringkasan.total_cn_terealisasi)]] as const).map(([l, n]) => (
          <div key={l} className="bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]">
            <div className="text-muted-foreground text-xs">{l}</div><div className="mt-1 text-xl font-bold tabular-nums">{n}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="pengajuan">
        <TabsList>
          <TabsTrigger value="pengajuan">Pengajuan ({pengajuan.length})</TabsTrigger>
          <TabsTrigger value="kontrak">Kontrak ({kontrak.length})</TabsTrigger>
          <TabsTrigger value="laporan">Laporan</TabsTrigger>
        </TabsList>

        <TabsContent value="pengajuan">
          <Card><CardContent className="pt-6">
            <DataTable
              columns={kolomCn} data={data} getKey={(r) => String(r.id)} pageSize={25}
              searchPlaceholder="Cari kode / customer…" onRowClick={(r) => setBuka(r.id)}
              empty={pengajuan.length === 0 ? "Belum ada pengajuan CN. Buat kontrak lalu klik Ajukan CN." : "Tidak ada yang cocok dengan filter."}
              toolbar={<div className="flex gap-2">
                <FilterSelect label="Status" value={status} onChange={setStatus}
                  options={(Object.keys(STATUS_LABEL) as CnStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
                {bolehBuat && <Button size="sm" onClick={() => setAjukan(true)}>Ajukan CN</Button>}
              </div>}
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="kontrak">
          <KontrakTab kontrak={kontrak} bolehBuat={bolehBuat} bolehKelola={bolehKelolaKontrak} onBaru={() => setKontrakBaru(true)} />
        </TabsContent>

        <TabsContent value="laporan"><LaporanTab /></TabsContent>
      </Tabs>

      {bolehBuat && <PengajuanDialog open={ajukan} onClose={() => setAjukan(false)} kontrak={kontrak.filter((k) => k.status === "aktif")} />}
      {bolehBuat && <KontrakDialog open={kontrakBaru} onClose={() => setKontrakBaru(false)} />}
      {buka != null && <DetailDialog key={buka} id={buka} onClose={() => setBuka(null)} bolehUbah={bolehUbah} pelaku={pelaku} me={me} />}
    </div>
  );
}

function KontrakTab({ kontrak, bolehBuat, bolehKelola, onBaru }: { kontrak: KontrakRow[]; bolehBuat: boolean; bolehKelola: boolean; onBaru: () => void }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function ubah(id: number, ke: "aktif" | "dibatalkan") {
    setBusy(id);
    setErr(null);
    try {
      await kirim(`/api/cn/kontrak/${id}/status`, jsonInit("POST", { ke }));
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const kolom: DataColumn<KontrakRow>[] = [
    { id: "kode", header: "Kontrak", sortable: true, accessor: (r) => r.kode, cell: (r) => (
      <div><div className="font-medium">{r.kode}</div><div className="text-muted-foreground text-xs">{r.created_by ?? "—"}</div></div>) },
    { id: "cust", header: "Customer", sortable: true, accessor: (r) => r.customer_name },
    { id: "tarif", header: "Tarif", accessor: (r) => tarifLabel(r.jenis, r.tarif) },
    { id: "periode", header: "Periode", sortable: true, accessor: (r) => r.periode_mulai, cell: (r) => `${tglId(r.periode_mulai)} – ${tglId(r.periode_selesai)}` },
    { id: "syarat", header: "Syarat", accessor: (r) => r.syarat ?? "", cell: (r) => (
      <div className="max-w-56 truncate text-sm" title={r.syarat ?? ""}>{r.syarat ?? "—"}{r.file_url && <> · <a className="text-primary underline" href={r.file_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>berkas</a></>}</div>) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", KONTRAK_CLS[r.status])}>{r.status}</span>) },
    ...(bolehKelola ? [{ id: "aksi", header: "", searchable: false, cell: (r: KontrakRow) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {r.status === "draft" && <Button size="xs" disabled={busy === r.id} onClick={() => void ubah(r.id, "aktif")}>Aktifkan</Button>}
        {r.status !== "dibatalkan" && <Button size="xs" variant="ghost" disabled={busy === r.id} onClick={() => void ubah(r.id, "dibatalkan")}>Batalkan</Button>}
      </div>) } as DataColumn<KontrakRow>] : []),
  ];

  return (
    <Card><CardContent className="space-y-2 pt-6">
      {err && <p className="text-destructive text-sm">{err}</p>}
      <p className="text-muted-foreground text-xs">Kontrak baru berstatus draft; Direktur mengaktifkannya sebelum bisa dipakai mengajukan CN.</p>
      <DataTable columns={kolom} data={kontrak} getKey={(r) => String(r.id)} pageSize={25} searchPlaceholder="Cari kode / customer…"
        empty="Belum ada kontrak CN."
        toolbar={bolehBuat ? <Button size="sm" onClick={onBaru}>Kontrak baru</Button> : undefined} />
    </CardContent></Card>
  );
}

function LaporanTab() {
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [d, setD] = useState<{ per_customer: LaporanBaris[]; per_sales: LaporanBaris[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    const qs = new URLSearchParams();
    if (dari) qs.set("dari", dari);
    if (sampai) qs.set("sampai", sampai);
    kirim<{ per_customer: LaporanBaris[]; per_sales: LaporanBaris[] }>(`/api/cn/laporan?${qs}`)
      .then((r) => { if (!batal) { setD(r); setErr(null); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [dari, sampai]);

  const kolom = (judul: string): DataColumn<LaporanBaris>[] => [
    { id: "label", header: judul, sortable: true, accessor: (r) => r.label },
    { id: "n", header: "Pengajuan", align: "right", sortable: true, accessor: (r) => r.jumlah_pengajuan, searchable: false },
    { id: "dpp", header: "DPP faktur", align: "right", sortable: true, accessor: (r) => r.total_dpp, searchable: false, cell: (r) => <span className="tabular-nums">{rupiah(r.total_dpp)}</span> },
    { id: "cn", header: "Nilai CN", align: "right", sortable: true, accessor: (r) => r.total_cn, searchable: false, cell: (r) => <span className="font-medium tabular-nums">{rupiah(r.total_cn)}</span> },
    { id: "real", header: "Terealisasi", align: "right", sortable: true, accessor: (r) => r.total_terealisasi, searchable: false, cell: (r) => <span className="tabular-nums">{rupiah(r.total_terealisasi)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Tanggal faktur</span>
        <Input type="date" className="w-40" value={dari} onChange={(e) => setDari(e.target.value)} aria-label="Dari tanggal" />
        <span>–</span>
        <Input type="date" className="w-40" value={sampai} onChange={(e) => setSampai(e.target.value)} aria-label="Sampai tanggal" />
        <span className="text-muted-foreground text-xs">Pengajuan ditolak/dibatalkan tidak dihitung.</span>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {d && (
        <>
          <Card><CardContent className="pt-6">
            <div className="mb-2 text-sm font-medium">Laporan CN per customer</div>
            <DataTable columns={kolom("Customer")} data={d.per_customer} getKey={(r) => r.kunci} pageSize={15} searchPlaceholder="Cari customer…" empty="Belum ada data CN." />
          </CardContent></Card>
          <Card><CardContent className="pt-6">
            <div className="mb-2 text-sm font-medium">Pembagian CN per sales</div>
            <DataTable columns={kolom("Sales")} data={d.per_sales} getKey={(r) => r.kunci} pageSize={15} searchPlaceholder="Cari sales…" empty="Belum ada data CN." />
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
