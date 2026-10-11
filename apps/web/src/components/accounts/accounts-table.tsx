"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import {
  HEALTH_LABEL, HEALTH_RANK, HealthBadge, KSO_RANK, KsoBadge,
  type KelasHealth, type KsoHealth, type StatusKso,
} from "@/components/accounts/health-badge";

export interface AccountRow {
  id: string; name: string; cabang: string | null; tipe: string | null; kelas_rs: string | null;
  wilayah: string | null; status_bayar: string | null; revenue: number; invoices: number;
  last_date: string | null; days_since: number | null; outstanding: number; contacts: number; dormant: boolean;
  owner_am_id?: string | null; owner_nama?: string | null;
  // F17 — Customer Health Cards
  health: KelasHealth; health_alasan: string; kso: KsoHealth | null;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => (Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toFixed(1)}M` : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toFixed(0)}jt` : rpFull.format(n));

// Filter status KSO punya satu pilihan ekstra: "Tanpa alat KSO" — akun yang
// memang bukan pelanggan KSO, beda dari pelanggan KSO yang tidak beli.
const TANPA_KSO = "TANPA";
const KSO_DEFAULT: Record<StatusKso, string> = { PERFECT_RUTIN: "Perfect Rutin", SESEKALI: "Sesekali", TIDAK_BELI: "Tidak beli" };

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [health, setHealth] = useState("");
  const [kso, setKso] = useState("");

  const healthOpts = useMemo(() => (Object.keys(HEALTH_LABEL) as KelasHealth[]).map((k) => ({
    value: k, label: `${HEALTH_LABEL[k]} (${accounts.filter((a) => a.health === k).length})`,
  })), [accounts]);
  const ksoOpts = useMemo(() => {
    // Label "Tidak beli 2026" ikut periode dari API — ambil dari data, bukan ditulis ulang.
    const label = (s: StatusKso) => accounts.find((a) => a.kso?.status === s)?.kso?.label ?? KSO_DEFAULT[s];
    const n = (s: StatusKso) => accounts.filter((a) => a.kso?.status === s).length;
    return [
      ...(Object.keys(KSO_RANK) as StatusKso[]).map((s) => ({ value: s, label: `${label(s)} (${n(s)})` })),
      { value: TANPA_KSO, label: `Tanpa alat KSO (${accounts.filter((a) => !a.kso).length})` },
    ];
  }, [accounts]);

  const data = useMemo(() => accounts.filter((a) =>
    (!health || a.health === health)
    && (!kso || (kso === TANPA_KSO ? !a.kso : a.kso?.status === kso))), [accounts, health, kso]);

  const columns: DataColumn<AccountRow>[] = [
    { id: "name", header: "Account", sortable: true, accessor: (r) => r.name, cell: (r) => (<div><div className="font-medium">{r.name}</div>{r.cabang && <div className="text-muted-foreground text-xs">{r.cabang}</div>}</div>) },
    { id: "health", header: "Health", sortable: true, accessor: (r) => HEALTH_RANK[r.health], cell: (r) => <HealthBadge kelas={r.health} alasan={r.health_alasan} /> },
    { id: "kso", header: "Status KSO", sortable: true, accessor: (r) => (r.kso ? KSO_RANK[r.kso.status] : 9), cell: (r) => <KsoBadge kso={r.kso} /> },
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
      data={data}
      getKey={(r) => r.id}
      searchPlaceholder="Cari account / cabang…"
      pageSize={25}
      onRowClick={(r) => router.push(`/accounts/${r.id}`)}
      empty={accounts.length ? "Tidak ada account yang cocok dengan filter." : "Belum ada account (butuh data faktur Accurate)."}
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect label="Health" value={health} onChange={setHealth} options={healthOpts} />
          <FilterSelect label="Status KSO" value={kso} onChange={setKso} options={ksoOpts} />
        </div>
      }
    />
  );
}
