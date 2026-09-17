"use client";

import { useState } from "react";

import { RaportList } from "@/components/raport/raport-list";
import { EmployeeSpineManager, type Dept, type EmployeeItem, type HodOpt } from "@/components/people/employee-spine-manager";
import { OkrOverview } from "@/components/karyawan/okr-overview";
import { KpiCatalog } from "@/components/karyawan/kpi-catalog";

// Karyawan 360 — hub: "Raport" (penilaian, read-only) · "OKR" & "KPI" (F157b,
// read-only, lintas orang) · "Kelola Profil" (editor spine + input pengukuran,
// admin saja).
//
// OKR & KPI ditaruh sebagai tab di sini, BUKAN menu baru: featureKey("/karyawan")
// sudah ada di matriks Akses Grup, jadi tidak perlu Sync Fitur dan tidak ada
// risiko fitur baru default-tertutup lalu hilang diam-diam di prod.
type Tab = "raport" | "okr" | "kpi" | "kelola";

export function Karyawan360({
  canManage,
  departments,
  employees,
  hods,
}: {
  canManage: boolean;
  departments: Dept[];
  employees: EmployeeItem[];
  hods: HodOpt[];
}) {
  const [tab, setTab] = useState<Tab>("raport");
  const btn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;

  const tabs: { v: Tab; label: string }[] = [
    { v: "raport", label: "Raport (penilaian)" },
    { v: "okr", label: "OKR" },
    { v: "kpi", label: "KPI" },
    ...(canManage ? [{ v: "kelola" as Tab, label: "Kelola Profil" }] : []),
  ];
  // Tab "kelola" hanya ada untuk admin; kalau state terlanjur ke sana tanpa izin,
  // jatuhkan ke Raport alih-alih merender editor.
  const active: Tab = tab === "kelola" && !canManage ? "raport" : tab;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {tabs.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)} className={btn(active === t.v)}>
            {t.label}
          </button>
        ))}
      </div>

      {active === "raport" ? <RaportList /> : null}
      {active === "okr" ? <OkrOverview /> : null}
      {active === "kpi" ? <KpiCatalog /> : null}
      {active === "kelola" ? <EmployeeSpineManager departments={departments} employees={employees} hods={hods} /> : null}
    </div>
  );
}
