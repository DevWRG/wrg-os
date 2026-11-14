"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { kirim, PRIORITAS, SEGMEN, TIPE_PROYEK, type Proyek } from "./types";

export type Faskes = { id: number; nama: string; no: string | null };
type Karyawan = { id: string; nama: string };

const opsi = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

/** Kotak cari faskes (master pelanggan Accurate). Memilih faskes mengisi nama RS bila masih kosong. */
export function CariFaskes({ value, onPilih }: { value: Faskes | null; onPilih: (f: Faskes | null) => void }) {
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<Faskes[]>([]);
  const cukup = q.trim().length >= 2;
  useEffect(() => {
    if (!cukup) return;
    const t = setTimeout(() => {
      kirim<{ items: Faskes[] }>(`/api/proyek-hd/faskes?q=${encodeURIComponent(q.trim())}`).then((d) => setHasil(d.items)).catch(() => setHasil([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, cukup]);
  if (value) {
    return (
      <div className="bg-card flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span>{value.nama}{value.no ? <span className="text-muted-foreground"> · {value.no}</span> : null}</span>
        <Button size="xs" variant="outline" onClick={() => onPilih(null)}>Ganti</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik min. 2 huruf nama faskes…" />
      {cukup && hasil.length > 0 && (
        <div className="bg-card max-h-40 overflow-y-auto rounded-md border text-sm">
          {hasil.map((f) => (
            <button key={f.id} type="button" className="hover:bg-accent block w-full px-3 py-1.5 text-left" onClick={() => { onPilih(f); setQ(""); }}>
              {f.nama}{f.no ? <span className="text-muted-foreground"> · {f.no}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TambahProyekDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const [karyawan, setKaryawan] = useState<Karyawan[]>([]);
  const [faskes, setFaskes] = useState<Faskes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    nama_rs: "", kota: "", segmen: "", tipe_proyek: "Start New", prioritas: "Gas", nama_alat: "", unit_kso: "", unit_terinstal: "0",
    harga_unit: "", nomor_kontrak: "", target_tindakan_bln: "", target_golive: "", pic_employee_id: "", next_action: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    kirim<{ karyawan: Karyawan[] }>("/api/proyek-hd/ref").then((d) => setKaryawan(d.karyawan)).catch(() => undefined);
  }, []);
  const opsiPic = useMemo(() => karyawan.map((k) => ({ value: k.id, label: k.nama })), [karyawan]);

  function pilihFaskes(x: Faskes | null) {
    setFaskes(x);
    if (x && !f.nama_rs.trim()) setF((s) => ({ ...s, nama_rs: x.nama }));
  }

  async function simpan() {
    setBusy(true);
    setErr(null);
    const angka = (s: string) => (s.trim() === "" ? null : Number(s));
    try {
      const p = await kirim<Proyek>("/api/proyek-hd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...f, account_id: faskes?.id ?? null, unit_kso: angka(f.unit_kso), unit_terinstal: angka(f.unit_terinstal) ?? 0,
          harga_unit: angka(f.harga_unit), target_tindakan_bln: angka(f.target_tindakan_bln),
        }),
      });
      onSaved(p.id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah proyek HD</DialogTitle>
          <DialogDescription>Proyek baru mulai di tahap 1 (Deal). Satu RS boleh punya beberapa proyek.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          {err && <p className="text-destructive text-sm sm:col-span-2">{err}</p>}
          <div className="space-y-1 sm:col-span-2">
            <Label>Faskes di WRG-OS (opsional, untuk menautkan data pelanggan)</Label>
            <CariFaskes value={faskes} onPilih={pilihFaskes} />
          </div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tp-rs">Nama Customer / RS</Label>
            <Input id="tp-rs" value={f.nama_rs} onChange={(e) => set("nama_rs")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-kota">Kota</Label>
            <Input id="tp-kota" value={f.kota} onChange={(e) => set("kota")(e.target.value)} /></div>
          <div className="space-y-1"><Label>Segmen</Label>
            <Combobox value={f.segmen} onChange={set("segmen")} options={opsi(SEGMEN)} emptyOption="—" /></div>
          <div className="space-y-1"><Label>Tipe proyek</Label>
            <Combobox value={f.tipe_proyek} onChange={set("tipe_proyek")} options={opsi(TIPE_PROYEK)} /></div>
          <div className="space-y-1"><Label>Prioritas</Label>
            <Combobox value={f.prioritas} onChange={set("prioritas")} options={opsi(PRIORITAS)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-alat">Nama alat</Label>
            <Input id="tp-alat" value={f.nama_alat} onChange={(e) => set("nama_alat")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-harga">Harga unit (Rp)</Label>
            <Input id="tp-harga" type="number" min={0} value={f.harga_unit} onChange={(e) => set("harga_unit")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-kso">Jml unit KSO</Label>
            <Input id="tp-kso" type="number" min={1} value={f.unit_kso} onChange={(e) => set("unit_kso")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-inst">Jml unit terinstal</Label>
            <Input id="tp-inst" type="number" min={0} value={f.unit_terinstal} onChange={(e) => set("unit_terinstal")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-target">Target tindakan / bulan</Label>
            <Input id="tp-target" type="number" min={0} value={f.target_tindakan_bln} onChange={(e) => set("target_tindakan_bln")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-golive">Target go-live</Label>
            <Input id="tp-golive" type="month" value={f.target_golive} onChange={(e) => set("target_golive")(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="tp-kontrak">Nomor MOU / PKS / SPK</Label>
            <Input id="tp-kontrak" value={f.nomor_kontrak} placeholder="kosong = masih proses" onChange={(e) => set("nomor_kontrak")(e.target.value)} /></div>
          <div className="space-y-1"><Label>PIC</Label>
            <Combobox value={f.pic_employee_id} onChange={set("pic_employee_id")} options={opsiPic} emptyOption="—" searchPlaceholder="Cari karyawan…" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="tp-next">Langkah berikutnya</Label>
            <Input id="tp-next" value={f.next_action} onChange={(e) => set("next_action")(e.target.value)} /></div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="button" disabled={busy || !f.nama_rs.trim() || !(Number(f.unit_kso) > 0)} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan proyek"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
