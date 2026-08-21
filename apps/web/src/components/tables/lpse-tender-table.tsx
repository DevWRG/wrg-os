"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { LpseTenderAdvanceActions } from "@/components/crm/lpse-tender-advance-actions";
import { LpseTenderTimelineButton } from "@/components/crm/lpse-tender-timeline-button";

export interface LpseTender {
  id: string;
  tender_no: string | null;
  judul: string;
  instansi: string;
  platform: string;
  pic_employee_id: string | null;
  pic_nama: string | null;
  dept_label: string | null;
  status: string;
  pesan_masuk_at: string;
  barang_dikirim_at: string | null;
  selesai_at: string | null;
  notes: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pesan_masuk: "Pesan Masuk",
  barang_dikirim: "Barang Dikirim",
  selesai: "Selesai",
};
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default"> = {
  pesan_masuk: "outline",
  barang_dikirim: "secondary",
  selesai: "default",
};
const PLATFORM_LABEL: Record<string, string> = { lpse: "LPSE", e_catalog: "E-Catalog" };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function LpseTenderTable({ tenders }: { tenders: LpseTender[] }) {
  const columns: DataColumn<LpseTender>[] = [
    {
      id: "tender",
      header: "Tender",
      sortable: true,
      accessor: (t) => t.judul,
      cell: (t) => (
        <div>
          <div className="font-medium">{t.judul}</div>
          <div className="text-muted-foreground text-xs">
            {t.tender_no ? `${t.tender_no} · ` : ""}
            {PLATFORM_LABEL[t.platform] ?? t.platform}
          </div>
        </div>
      ),
    },
    { id: "instansi", header: "Instansi", sortable: true, accessor: (t) => t.instansi },
    {
      id: "pic",
      header: "PIC",
      cell: (t) => <span>{t.pic_nama ?? "-"}{t.dept_label ? ` (${t.dept_label})` : ""}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (t) => <Badge variant={STATUS_VARIANT[t.status] ?? "outline"}>{STATUS_LABEL[t.status] ?? t.status}</Badge>,
    },
    { id: "masuk", header: "Pesan Masuk", cell: (t) => fmt(t.pesan_masuk_at) },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
          <LpseTenderAdvanceActions tenderId={t.id} status={t.status} />
          <LpseTenderTimelineButton tenderId={t.id} judul={t.judul} />
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={tenders} getKey={(t) => t.id} searchPlaceholder="Cari tender/instansi…" pageSize={25} />;
}
