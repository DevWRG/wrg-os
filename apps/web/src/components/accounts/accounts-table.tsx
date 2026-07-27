"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface AccountRow {
  id: string; name: string; cabang: string | null; tipe: string | null; kelas_rs: string | null;
  wilayah: string | null; status_bayar: string | null; revenue: number; invoices: number;
  last_date: string | null; days_since: number | null; outstanding: number; contacts: number; dormant: boolean;
  owner_am_id?: string | null; owner_nama?: string | null;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(1)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const columns: DataColumn<AccountRow>[] = [
    { id: "name", header: "Account", sortable: true, accessor: (r) => r.name, cell: (r) => (<div><div className="font-medium">{r.name}</div>{r.cabang && <div className="text-muted-foreground text-xs">{r.cabang}</div>}</div>) },
    { id: "tipe", header: "Tipe", sortable: true, accessor: (r) => r.tipe ?? "", cell: (r) => r.tipe ? <Badge variant="outline">{r.tipe}{r.kelas_rs ? ` ${r.kelas_rs}` : ""}</Badge> : <span className="text-muted-foreground">—</span> },
    // Pemilik = crm_account.owner_am_id (bukan salesman invoice terakhir) — ini
    // yang menentukan siapa yang bisa melihat account ini.
    { id: "owner", header: "Pemilik (AM)", sortable: true, accessor: (r) => r.owner_nama ?? "", cell: (r) => (r.owner_nama ? r.owner_nama : <span className="text-muted-foreground">Belum ada pemilik</span>) },
    { id: "revenue", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.revenue, cell: (r) => <span title={rpFull.format(r.revenue)}>{rpC(r.revenue)}</span> },
    { id: "outstanding", header: "AR (outstanding)", align: "right", sortable: true, accessor: (r) => r.outstanding, cell: (r) => (r.outstanding > 0 ? <span className="text-rose-600" title={rpFull.format(r.outstanding)}>{rpC(r.outstanding)}</span> : "—") },
    { id: "last", header: "Order terakhir", sortable: true, accessor: (r) => r.last_date ?? "", cell: (r) => (<span className={r.dormant ? "text-amber-600" : ""}>{r.last_date ?? "—"}</span>) },
    { id: "contacts", header: "Kontak", align: "right", sortable: true, accessor: (r) => r.contacts, cell: (r) => (r.contacts > 0 ? r.contacts : <span className="text-muted-foreground">0</span>) },
  ];
  return (
    <DataTable
      columns={columns}
      data={accounts}
      getKey={(r) => r.id}
      searchPlaceholder="Cari account / cabang…"
      pageSize={25}
      onRowClick={(r) => router.push(`/accounts/${r.id}`)}
      empty="Belum ada account (butuh data faktur Accurate)."
    />
  );
}
