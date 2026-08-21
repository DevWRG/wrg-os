"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export interface EmployeeOption {
  id: string;
  nama: string;
  dept_label: string | null;
}

const KATEGORI_LABEL: Record<string, string> = {
  kebutuhan_kantor: "Kebutuhan Kantor",
  perjalanan_dinas: "Perjalanan Dinas",
  lainnya: "Lainnya",
};
const NONE = "__none__";

// Input manual — buat coba tanpa kirim WA sungguhan. TANPA OCR, semua field
// diketik langsung (beda dari ingestion normal via #KLAIM+foto).
export function AddDocKlaimButton({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState(NONE);
  const [senderName, setSenderName] = useState("");
  const [nomorDokumen, setNomorDokumen] = useState("");
  const [tanggalDokumen, setTanggalDokumen] = useState("");
  const [nominal, setNominal] = useState("");
  const [pihak, setPihak] = useState("");
  const [kategori, setKategori] = useState(NONE);
  const [catatan, setCatatan] = useState("");

  function reset() {
    setEmployeeId(NONE); setSenderName(""); setNomorDokumen(""); setTanggalDokumen("");
    setNominal(""); setPihak(""); setKategori(NONE); setCatatan("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/doc-klaim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId === NONE ? undefined : employeeId,
          sender_name: senderName.trim() || undefined,
          nomor_dokumen: nomorDokumen.trim() || undefined,
          tanggal_dokumen: tanggalDokumen.trim() || undefined,
          nominal: nominal.trim() || undefined,
          pihak: pihak.trim() || undefined,
          kategori: kategori === NONE ? undefined : kategori,
          catatan: catatan.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "gagal menyimpan");
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Tambah Klaim (manual)
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah klaim manual</DialogTitle>
          <DialogDescription>Buat coba tanpa kirim WA — isi langsung, tanpa lewat OCR.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Karyawan (opsional)</Label>
              <Select value={employeeId} onValueChange={(v) => setEmployeeId(v ?? NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih karyawan">{(v: string) => (v === NONE ? "Pilih karyawan" : employees.find((e) => e.id === v)?.nama ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— tidak pilih —</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nama}{e.dept_label ? ` (${e.dept_label})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Atau kalau belum terdaftar, isi nama bebas:</p>
              <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Nama bebas" disabled={employeeId !== NONE} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dk-nomor">No. Dokumen</Label>
              <Input id="dk-nomor" value={nomorDokumen} onChange={(e) => setNomorDokumen(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dk-tanggal">Tanggal</Label>
              <Input id="dk-tanggal" value={tanggalDokumen} onChange={(e) => setTanggalDokumen(e.target.value)} placeholder="opsional, mis. 10 Agustus 2026" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dk-nominal">Nominal</Label>
              <Input id="dk-nominal" value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="mis. Rp150.000" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dk-pihak">Pihak (toko/institusi)</Label>
              <Input id="dk-pihak" value={pihak} onChange={(e) => setPihak(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label>Kategori</Label>
              <Select value={kategori} onValueChange={(v) => setKategori(v ?? NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => (v === NONE ? "— belum ditriage —" : KATEGORI_LABEL[v] ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— belum ditriage —</SelectItem>
                  {Object.entries(KATEGORI_LABEL).map(([k, lbl]) => (
                    <SelectItem key={k} value={k}>{lbl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dk-catatan">Catatan</Label>
              <Textarea id="dk-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
