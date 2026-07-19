"use client";

import { useState } from "react";

import { RaportList } from "@/components/raport/raport-list";
import { EmployeeSpineManager, type Dept, type EmployeeItem, type HodOpt } from "@/components/people/employee-spine-manager";

// Karyawan 360 — hub gabungan: mode "Raport" (penilaian, read-only) + "Kelola
// Profil" (editor spine + input KPI, admin saja). Menggabungkan People Analytics
// (editor) & Raport Karyawan (penilaian) jadi satu menu.
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
  const [tab, setTab] = useState<"raport" | "kelola">("raport");
  const btn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;

  return (
    <div className="space-y-5">
      {canManage ? (
        <div className="flex flex-wrap gap-1 rounded-lg border p-1">
          <button onClick={() => setTab("raport")} className={btn(tab === "raport")}>Raport (penilaian)</button>
          <button onClick={() => setTab("kelola")} className={btn(tab === "kelola")}>Kelola Profil</button>
        </div>
      ) : null}

      {tab === "raport" || !canManage ? (
        <RaportList />
      ) : (
        <EmployeeSpineManager departments={departments} employees={employees} hods={hods} />
      )}
    </div>
  );
}
