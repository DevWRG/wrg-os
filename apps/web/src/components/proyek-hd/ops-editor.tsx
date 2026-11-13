"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";

import { kirim, tampil, type BarisOps, type Kolom, type Proyek, type TabOps } from "./types";

type Karyawan = { id: string; nama: string };

// Tabel + form generik untuk satu tab data operasional Proyek HD. Kolom & tipe datang dari
// spesifikasi API (/proyek-hd/ops-spek), jadi menambah kolom cukup di repo/proyek-hd-ops.ts.
export function OpsEditor({ tab, proyekId, boleh }: {
  tab: TabOps; proyekId: string | null; boleh: { buat: boolean; ubah: boolean; hapus: boolean };
}) {
  const [rows, setRows] = useState<BarisOps[] | null>(null);
  const [proyek, setProyek] = useState<Proyek[]>([]);
  const [karyawan, setKaryawan] = useState<Karyawan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<BarisOps | "baru" | null>(null);
  const [versi, setVersi] = useState(0);
  const { confirm, dialog } = useConfirm();
  const adaPic = tab.kolom.some((k) => k.tipe === "pic");

  useEffect(() => {
    let batal = false;
    const q = proyekId ? `?proyek_id=${encodeURIComponent(proyekId)}` : "";
    Promise.all([
      kirim<{ items: BarisOps[] }>(`/api/proyek-hd/ops/${tab.slug}${q}`),
      kirim<{ items: Proyek[] }>("/api/proyek-hd"),
      adaPic ? kirim<{ karyawan: Karyawan[] }>("/api/proyek-hd/ref").then((r) => r.karyawan) : Promise.resolve([] as Karyawan[]),
    ]).then(([r, p, k]) => {
      if (batal) return;
      setRows(r.items); setProyek(p.items); setKaryawan(k); setErr(null);
    }).catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [tab.slug, proyekId, adaPic, versi]);

  const muatUlang = () => setVersi((v) => v + 1);
  // Kolom tabel: maksimal 6 kolom spesifikasi supaya tetap terbaca; sisanya ada di form.
  const terlihat = tab.kolom.filter((k) => k.tipe !== "longtext" || k.wajib).slice(0, 6);
  const columns: DataColumn<BarisOps>[] = [
    ...(!proyekId ? [{
      id: "proyek", header: "Proyek", sortable: true, searchable: true, accessor: (r: BarisOps) => r.proyek_nama ?? "",
      cell: (r: BarisOps) => r.proyek_nama ? <div><div className="font-medium">{r.proyek_nama}</div><div className="text-muted-foreground text-xs">{r.proyek_kode}</div></div> : "—",
    }] : []),
    ...terlihat.map((k) => ({
      id: k.nama, header: k.label, sortable: true, searchable: k.tipe === "text" || k.tipe === "longtext" || k.tipe === "enum",
      align: (["rupiah", "percent", "int", "number"].includes(k.tipe) ? "right" : undefined) as "right" | undefined,
      accessor: (r: BarisOps) => (k.tipe === "pic" ? r.pic_nama ?? "" : (r[k.nama] as string | number | null) ?? ""),
      cell: (r: BarisOps) => <span className="line-clamp-2">{tampil(k, r[k.nama], r.pic_nama)}</span>,
    })),
    ...(boleh.ubah || boleh.hapus ? [{
      id: "aksi", header: "", cell: (r: BarisOps) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {boleh.ubah && <Button size="icon-sm" variant="soft" aria-label="Ubah" onClick={() => setEdit(r)}><Pencil /></Button>}
          {boleh.hapus && <Button size="icon-sm" variant="outline" aria-label="Hapus" onClick={() => confirm(
            { title: `Hapus baris ${tab.label}?`, description: "Baris ditandai terhapus dan hilang dari laporan.", confirmLabel: "Hapus", destructive: true },
            () => { kirim(`/api/proyek-hd/ops/${tab.slug}/${r.id}`, { method: "DELETE" }).then(muatUlang).catch((e) => setErr((e as Error).message)); },
          )}><Trash2 /></Button>}
        </div>
      ),
    }] : []),
  ];

  const sudahAda = tab.tunggal && proyekId && (rows?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{tab.label}{proyekId && proyek.length ? ` · ${proyek.find((p) => String(p.id) === proyekId)?.nama_rs ?? ""}` : ""}</CardTitle>
        {boleh.buat && !sudahAda && <Button onClick={() => setEdit("baru")}><Plus />Tambah</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        {err && <p className="text-destructive text-sm">{err}</p>}
        <DataTable columns={columns} data={rows ?? []} getKey={(r) => String(r.id)} pageSize={10}
          empty={rows ? "Belum ada data." : "Memuat…"} onRowClick={boleh.ubah ? (r) => setEdit(r) : undefined} />
      </CardContent>
      {edit && (
        <FormOps tab={tab} baris={edit === "baru" ? null : edit} proyekAwal={proyekId} proyek={proyek} karyawan={karyawan}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); muatUlang(); }} />
      )}
      {dialog}
    </Card>
  );
}

function nilaiAwal(k: Kolom, b: BarisOps | null): string | boolean {
  const v = b?.[k.nama];
  if (k.tipe === "bool") return v === true;
  return v === null || v === undefined ? "" : String(v);
}

function FormOps({ tab, baris, proyekAwal, proyek, karyawan, onClose, onSaved }: {
  tab: TabOps; baris: BarisOps | null; proyekAwal: string | null; proyek: Proyek[]; karyawan: Karyawan[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<Record<string, string | boolean>>(() => Object.fromEntries(tab.kolom.map((k) => [k.nama, nilaiAwal(k, baris)])));
  const [pid, setPid] = useState(baris?.proyek_id != null ? String(baris.proyek_id) : proyekAwal ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opsiProyek = useMemo(() => proyek.map((p) => ({ value: String(p.id), label: `${p.nama_rs} · ${p.kode}` })), [proyek]);
  const opsiPic = useMemo(() => karyawan.map((k) => ({ value: k.id, label: k.nama })), [karyawan]);

  async function simpan() {
    setBusy(true);
    setErr(null);
    const body: Record<string, unknown> = { ...f };
    for (const k of tab.kolom) {
      if (["int", "number", "rupiah", "percent"].includes(k.tipe) && f[k.nama] !== "") body[k.nama] = Number(f[k.nama]);
    }
    try {
      if (baris) {
        await kirim(`/api/proyek-hd/ops/${tab.slug}/${baris.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, diubah_at: baris.diubah_at }),
        });
      } else {
        await kirim(`/api/proyek-hd/ops/${tab.slug}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, proyek_id: pid || null }),
        });
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const wajibKosong = tab.kolom.some((k) => k.wajib && (f[k.nama] === "" || f[k.nama] === undefined)) || (!pid && !tab.proyekOpsional);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{baris ? "Ubah" : "Tambah"} · {tab.label}</DialogTitle></DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          {err && <p className="text-destructive text-sm sm:col-span-2">{err}</p>}
          {!baris && !proyekAwal && (
            <div className="space-y-1 sm:col-span-2"><Label>Proyek{tab.proyekOpsional ? " (opsional)" : ""}</Label>
              <Combobox value={pid} onChange={setPid} options={opsiProyek} emptyOption={tab.proyekOpsional ? "— belum jadi proyek —" : undefined} searchPlaceholder="Cari RS…" /></div>
          )}
          {tab.kolom.map((k) => {
            const id = `ops-${k.nama}`;
            const label = `${k.label}${k.wajib ? " *" : ""}`;
            if (k.tipe === "bool") {
              return (
                <label key={k.nama} className="flex items-center gap-2 text-sm sm:col-span-1">
                  <Checkbox checked={f[k.nama] === true} onCheckedChange={(v) => setF({ ...f, [k.nama]: v === true })} />{k.label}
                </label>
              );
            }
            const lebar = k.tipe === "longtext" ? "sm:col-span-2" : "";
            return (
              <div key={k.nama} className={`space-y-1 ${lebar}`}>
                <Label htmlFor={id}>{label}</Label>
                {k.tipe === "longtext" ? (
                  <Textarea id={id} rows={3} className="bg-card" value={String(f[k.nama])} onChange={(e) => setF({ ...f, [k.nama]: e.target.value })} />
                ) : k.tipe === "enum" ? (
                  <Combobox id={id} value={String(f[k.nama])} onChange={(v) => setF({ ...f, [k.nama]: v })}
                    options={(k.pilihan ?? []).map((x) => ({ value: x, label: x }))} emptyOption={k.wajib ? undefined : "—"} />
                ) : k.tipe === "pic" ? (
                  <Combobox id={id} value={String(f[k.nama])} onChange={(v) => setF({ ...f, [k.nama]: v })} options={opsiPic} emptyOption="—" searchPlaceholder="Cari karyawan…" />
                ) : (
                  <Input id={id} className="bg-card" value={String(f[k.nama])} onChange={(e) => setF({ ...f, [k.nama]: e.target.value })}
                    type={k.tipe === "date" ? "date" : k.tipe === "month" ? "month" : ["int", "number", "rupiah", "percent"].includes(k.tipe) ? "number" : "text"}
                    min={["int", "number", "rupiah", "percent"].includes(k.tipe) ? 0 : undefined} max={k.tipe === "percent" ? 100 : undefined}
                    step={k.tipe === "int" ? 1 : "any"} />
                )}
              </div>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button disabled={busy || wajibKosong} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
