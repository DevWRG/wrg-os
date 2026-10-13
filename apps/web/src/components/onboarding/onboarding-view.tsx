"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import { DetailDialog, MulaiDialog, TemplateDialog } from "./dialogs";
import { CASE_CLS, CASE_LABEL, KATEGORI_LABEL, jsonInit, kirim, tglId, type CaseStatus, type OnboardingCase, type Template } from "./types";

type Tab = "onboarding" | "template";

// F56 Onboarding Checklist — daftar onboarding + (admin/Direktur) template checklist.
// Data dari apps/api/src/repo/onboarding.ts (baris sudah di-scope server).
export function OnboardingView({ cases, templates, dept, bolehTambah, bolehUbah, bolehTemplate }: {
  cases: OnboardingCase[]; templates: Template[] | null; dept: { key: string; label: string }[];
  bolehTambah: boolean; bolehUbah: boolean; bolehTemplate: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("onboarding");
  const [status, setStatus] = useState("");
  const [buka, setBuka] = useState<number | null>(null);
  const [mulai, setMulai] = useState(false);
  const [tpl, setTpl] = useState<{ open: boolean; awal: Template | null }>({ open: false, awal: null });
  const [err, setErr] = useState<string | null>(null);

  const data = useMemo(() => cases.filter((c) => !status || c.status === status), [cases, status]);
  const berjalan = cases.filter((c) => c.status === "berjalan");
  const terlambat = berjalan.filter((c) => c.progress.terlambat > 0).length;

  const kolom: DataColumn<OnboardingCase>[] = [
    { id: "nama", header: "Karyawan", sortable: true, accessor: (c) => c.nama, cell: (c) => (
      <div><div className="font-medium">{c.nama}</div><div className="text-muted-foreground text-xs">{[c.role, c.cabang].filter(Boolean).join(" · ") || "—"}</div></div>) },
    { id: "mulai", header: "Mulai", sortable: true, accessor: (c) => c.tanggal_mulai, cell: (c) => <span className="tabular-nums text-sm">{tglId(c.tanggal_mulai)}</span> },
    { id: "progres", header: "Progres", sortable: true, accessor: (c) => c.progress.persen, cell: (c) => (
      <div className="min-w-32">
        <div className="bg-muted h-1.5 overflow-hidden rounded"><div className="bg-primary h-full" style={{ width: `${c.progress.persen}%` }} /></div>
        <div className="text-muted-foreground mt-1 text-xs tabular-nums">{c.progress.selesai + c.progress.dilewati}/{c.progress.total} · {c.progress.persen}%</div>
      </div>) },
    { id: "telat", header: "Terlambat", align: "right", sortable: true, accessor: (c) => c.progress.terlambat, cell: (c) => c.progress.terlambat
      ? <span className="font-medium text-rose-700 dark:text-rose-400">{c.progress.terlambat} butir</span> : <span className="text-muted-foreground">—</span> },
    { id: "status", header: "Status", sortable: true, accessor: (c) => c.status, cell: (c) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", CASE_CLS[c.status])}>{CASE_LABEL[c.status]}</span>) },
  ];

  async function toggleAktif(t: Template) {
    setErr(null);
    try {
      await kirim(`/api/onboarding/templates/${t.id}`, jsonInit("PATCH", { aktif: !t.aktif }));
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const kolomTpl: DataColumn<Template>[] = [
    { id: "kat", header: "Kategori", sortable: true, accessor: (t) => t.kategori, cell: (t) => KATEGORI_LABEL[t.kategori] },
    { id: "judul", header: "Butir", sortable: true, accessor: (t) => t.judul, cell: (t) => (
      <div><div className={cn("font-medium", !t.aktif && "text-muted-foreground line-through")}>{t.judul}</div>{t.keterangan && <div className="text-muted-foreground text-xs">{t.keterangan}</div>}</div>) },
    { id: "berlaku", header: "Berlaku untuk", accessor: (t) => t.dept_label ?? "", cell: (t) => (
      <span className="text-sm">{t.dept_label ?? "Semua departemen"}{t.role_pattern ? ` · “${t.role_pattern}”` : ""}</span>) },
    { id: "due", header: "Tenggat", align: "right", sortable: true, accessor: (t) => t.due_days, cell: (t) => `+${t.due_days} hari` },
    { id: "pic", header: "PIC", accessor: (t) => t.pic ?? "", cell: (t) => t.pic ?? "—" },
    { id: "aksi", header: "", accessor: () => "", cell: (t) => bolehUbah ? (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setTpl({ open: true, awal: t })}>Ubah</Button>
        <Button size="sm" variant="ghost" onClick={() => void toggleAktif(t)}>{t.aktif ? "Nonaktifkan" : "Aktifkan"}</Button>
      </div>) : null },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button size="sm" variant={tab === "onboarding" ? "default" : "ghost"} onClick={() => setTab("onboarding")}>Onboarding</Button>
          {bolehTemplate && <Button size="sm" variant={tab === "template" ? "default" : "ghost"} onClick={() => setTab("template")}>Template checklist</Button>}
        </div>
        {tab === "onboarding" && bolehTambah && <Button size="sm" onClick={() => setMulai(true)}>Mulai onboarding</Button>}
        {tab === "template" && bolehTambah && <Button size="sm" onClick={() => setTpl({ open: true, awal: null })}>Tambah template</Button>}
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}

      {tab === "onboarding" && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[["Sedang berjalan", berjalan.length], ["Ada butir terlambat", terlambat], ["Selesai", cases.filter((c) => c.status === "selesai").length]].map(([l, n]) => (
              <div key={String(l)} className="bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]">
                <div className="text-muted-foreground text-xs">{l}</div><div className="mt-1 text-xl font-bold tabular-nums">{n}</div>
              </div>
            ))}
          </div>
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={kolom} data={data} getKey={(c) => String(c.id)} pageSize={25}
                searchPlaceholder="Cari karyawan…" onRowClick={(c) => setBuka(c.id)}
                empty={cases.length === 0 ? "Belum ada onboarding. Klik Mulai onboarding untuk karyawan baru." : "Tidak ada yang cocok dengan filter."}
                toolbar={<FilterSelect label="Status" value={status} onChange={setStatus}
                  options={(Object.keys(CASE_LABEL) as CaseStatus[]).map((s) => ({ value: s, label: CASE_LABEL[s] }))} />}
              />
            </CardContent>
          </Card>
        </>
      )}

      {tab === "template" && templates && (
        <Card>
          <CardContent className="pt-6">
            <DataTable columns={kolomTpl} data={templates} getKey={(t) => String(t.id)} pageSize={25} searchPlaceholder="Cari butir…" empty="Belum ada template." />
          </CardContent>
        </Card>
      )}

      <MulaiDialog open={mulai} onClose={() => setMulai(false)} />
      {buka != null && <DetailDialog key={buka} id={buka} onClose={() => setBuka(null)} bolehUbah={bolehUbah} />}
      {tpl.open && <TemplateDialog key={tpl.awal?.id ?? "baru"} open awal={tpl.awal} dept={dept} onClose={() => setTpl({ open: false, awal: null })} />}
    </div>
  );
}
