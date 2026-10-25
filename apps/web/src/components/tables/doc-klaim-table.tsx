"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DocKlaimTriage } from "@/components/crm/doc-klaim-triage";
import { DocKlaimApproval } from "@/components/crm/doc-klaim-approval";
import type { PemutusKlaim } from "@/lib/doc-klaim-access";
import { DocKlaimDeleteButton } from "@/components/crm/doc-klaim-delete-button";

export interface DocKlaim {
  id: string;
  sender_name: string | null;
  employee_id: string | null;
  employee_nama: string | null;
  media_path: string | null;
  caption: string | null;
  raw_text: string | null;
  nomor_dokumen: string | null;
  tanggal_dokumen: string | null;
  nominal: string | null;
  pihak: string | null;
  ocr_dry_run: boolean;
  kategori: string | null;
  status: string;
  am_id: string | null;
  hod_key: string | null;
  hod_nama: string | null;
  dibayar_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  nominal_disetujui: number | null;
  dibayar_at: string | null;
  catatan: string | null;
  created_at: string;
  // Approval di mesin F11 (migrasi 250); null = klaim lama.
  approval_request_id?: string | null;
  approval_kode?: string | null;
}

const STATUS_LABEL: Record<string, string> = { baru: "Baru", disetujui: "Disetujui", ditolak: "Ditolak", dibayar: "Dibayar" };
const STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  baru: "outline",
  disetujui: "secondary",
  ditolak: "destructive",
  dibayar: "default",
};
const KATEGORI_LABEL: Record<string, string> = {
  kebutuhan_kantor: "Kebutuhan Kantor",
  perjalanan_dinas: "Perjalanan Dinas",
  lainnya: "Lainnya",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function DocKlaimTable({ klaim, pemutus }: { klaim: DocKlaim[]; pemutus: PemutusKlaim }) {
  const columns: DataColumn<DocKlaim>[] = [
    {
      id: "masuk",
      header: "Masuk",
      sortable: true,
      accessor: (k) => k.created_at,
      cell: (k) => (
        <div>
          <div>{fmt(k.created_at)}</div>
          <div className="text-muted-foreground text-xs">
            {k.employee_nama ?? k.sender_name ?? "-"}
            {!k.employee_id && k.sender_name && <Badge variant="outline" className="ml-1">belum terhubung roster</Badge>}
          </div>
        </div>
      ),
    },
    {
      id: "ekstraksi",
      header: "Hasil Ekstraksi (OCR)",
      cell: (k) =>
        k.ocr_dry_run ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline">Dry-run</Badge>
            <span className="text-muted-foreground text-xs">OCR belum aktif</span>
          </div>
        ) : (
          <div className="text-xs">
            {k.nomor_dokumen && <div>No: {k.nomor_dokumen}</div>}
            {k.tanggal_dokumen && <div>Tanggal: {k.tanggal_dokumen}</div>}
            {k.nominal && <div>Nominal: {k.nominal}</div>}
            {k.pihak && <div>Pihak: {k.pihak}</div>}
            {!k.nomor_dokumen && !k.tanggal_dokumen && !k.nominal && !k.pihak && (
              <span className="text-muted-foreground">Tak terekstrak — lihat teks mentah</span>
            )}
          </div>
        ),
    },
    {
      id: "foto",
      header: "Foto",
      // Thumbnail nota — klik membuka ukuran penuh di tab baru. Dulu kolom ini
      // cuma menampilkan path berkas di server, jadi approver menyetujui
      // reimburse tanpa bisa melihat struknya.
      cell: (k) =>
        k.media_path ? (
          <a href={`/api/doc-klaim/${k.id}/foto`} target="_blank" rel="noopener noreferrer" title="Buka foto nota">
            {/* eslint-disable-next-line @next/next/no-img-element -- foto dari BFF ber-gerbang, bukan aset statis */}
            <img src={`/api/doc-klaim/${k.id}/foto`} alt="Foto nota" loading="lazy" className="h-14 w-14 rounded border object-cover" />
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">tanpa foto (input manual)</span>
        ),
    },
    {
      id: "kategori",
      header: "Kategori",
      cell: (k) => (
        <div className="flex items-center gap-1">
          {k.kategori ? <Badge variant="outline">{KATEGORI_LABEL[k.kategori] ?? k.kategori}</Badge> : <span className="text-muted-foreground text-xs">-</span>}
          <DocKlaimTriage id={k.id} initialKategori={k.kategori} />
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (k) => (
        <div className="flex flex-col gap-0.5">
          <Badge variant={STATUS_VARIANT[k.status] ?? "outline"}>{STATUS_LABEL[k.status] ?? k.status}</Badge>
          {k.decided_by_name && <span className="text-muted-foreground text-xs">oleh {k.decided_by_name}</span>}
          {k.nominal_disetujui != null && <span className="text-muted-foreground text-xs">Disetujui: {rupiah(k.nominal_disetujui)}</span>}
          {k.status === "baru" && (
            <span className="text-muted-foreground text-xs">
              {k.hod_nama ? `Approver: HoD ${k.hod_nama}` : "Approver: Direktur/admin"}
            </span>
          )}
          {k.dibayar_by_name && <span className="text-muted-foreground text-xs">dibayar oleh {k.dibayar_by_name}</span>}
        </div>
      ),
    },
    {
      id: "aksi",
      header: "Aksi",
      align: "right",
      cell: (k) => (
        <div className="flex items-center justify-end gap-1">
          <DocKlaimApproval klaim={k} pemutus={pemutus} />
          {/* Hanya klaim yang belum diputuskan yang boleh dihapus (server juga menolak). */}
          {k.status === "baru" && (
            <DocKlaimDeleteButton id={k.id} label={k.employee_nama ?? k.sender_name ?? k.id} />
          )}
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={klaim} getKey={(k) => k.id} searchPlaceholder="Cari pengirim/dokumen…" pageSize={25} />;
}
