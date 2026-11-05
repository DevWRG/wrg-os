"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";

import { MAKS_BERKAS, REF, hariIni, json, kirim, tgl, ukuranTeks, type Arsip, type Buku } from "./types";

function Bingkai({ judul, deskripsi, onClose, children }: { judul: string; deskripsi?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{judul}</DialogTitle>
          {deskripsi && <DialogDescription>{deskripsi}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="space-y-3">{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function Kolom({ id, label, children, wajib }: { id: string; label: string; children: React.ReactNode; wajib?: boolean }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}{wajib && <span className="text-destructive"> *</span>}</Label>
      {children}
    </div>
  );
}

type Meta = { judul: string; akun: string; lokasi_fisik: string; keterangan: string; ref_faktur: string; ref_sj: string; ref_po: string; ref_sn: string };
const metaAwal = (a?: Arsip | null): Meta => ({
  judul: a?.judul ?? "", akun: a?.akun ?? "", lokasi_fisik: a?.lokasi_fisik ?? "", keterangan: a?.keterangan ?? "",
  ref_faktur: a?.ref_faktur ?? "", ref_sj: a?.ref_sj ?? "", ref_po: a?.ref_po ?? "", ref_sn: a?.ref_sn ?? "",
});

/** Isian metadata bersama — unggah & ubah. */
function IsianMeta({ f, set, pre }: { f: Meta; set: (m: Meta) => void; pre: string }) {
  const isi = (k: keyof Meta) => (e: { target: { value: string } }) => set({ ...f, [k]: e.target.value });
  return (
    <>
      <Kolom id={`${pre}-judul`} label="Judul / isi dokumen" wajib>
        <Input id={`${pre}-judul`} value={f.judul} onChange={isi("judul")} placeholder="mis. Pembayaran listrik kantor Oktober" maxLength={200} />
      </Kolom>
      <div className="grid gap-3 sm:grid-cols-2">
        <Kolom id={`${pre}-akun`} label="Akun / bank">
          <Input id={`${pre}-akun`} value={f.akun} onChange={isi("akun")} placeholder="mis. BCA 123 · Biaya Listrik" maxLength={120} />
        </Kolom>
        <Kolom id={`${pre}-lokasi`} label="Lokasi hardfile">
          <Input id={`${pre}-lokasi`} value={f.lokasi_fisik} onChange={isi("lokasi_fisik")} placeholder="mis. Odner BKK Nov 2026 · Kardus 11/2026" maxLength={120} />
        </Kolom>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {REF.map((r) => (
          <Kolom key={r.key} id={`${pre}-${r.key}`} label={r.label}>
            <Input id={`${pre}-${r.key}`} value={f[r.key]} onChange={isi(r.key)} placeholder={r.contoh} maxLength={80} />
          </Kolom>
        ))}
      </div>
      <Kolom id={`${pre}-ket`} label="Keterangan">
        <Textarea id={`${pre}-ket`} value={f.keterangan} onChange={isi("keterangan")} rows={2} maxLength={1000} />
      </Kolom>
    </>
  );
}

// ---------------------------------------------------------------- unggah

export function UnggahDialog({ buku, onClose, onTersimpan }: { buku: Buku[]; onClose: () => void; onTersimpan: (a: Arsip) => void }) {
  const [kode, setKode] = useState("");
  const [tanggal, setTanggal] = useState(hariIni());
  const [meta, setMeta] = useState<Meta>(metaAwal());
  const [file, setFile] = useState<File | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pilihBerkas = (f: File | null) => {
    setErr(null);
    if (f && f.size > MAKS_BERKAS) { setErr(`Berkas ${ukuranTeks(f.size)} — maksimal 8 MB. Perkecil resolusi scan atau pisah per lembar.`); setFile(null); return; }
    setFile(f);
  };
  const simpan = async () => {
    if (!kode) { setErr("Pilih kode buku."); return; }
    if (!meta.judul.trim()) { setErr("Judul dokumen wajib diisi."); return; }
    if (!file) { setErr("Pilih berkas scan (PDF, JPG, atau PNG)."); return; }
    setSibuk(true); setErr(null);
    const fd = new FormData();
    fd.set("file", file, file.name);
    fd.set("buku_kode", kode);
    fd.set("tanggal_dokumen", tanggal);
    for (const [k, v] of Object.entries(meta)) fd.set(k, v);
    try {
      onTersimpan(await kirim<Arsip>("/api/arsip-dokumen", { method: "POST", body: fd }));
    } catch (e) {
      setErr((e as Error).message);
      setSibuk(false);
    }
  };

  return (
    <Bingkai judul="Unggah dokumen" deskripsi="Nomor arsip dibuat otomatis dari kode buku + bulan tanggal dokumen. Berkas disimpan di Google Drive perusahaan (tidak dibagikan publik)." onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Kolom id="u-buku" label="Kode buku" wajib>
          <Combobox id="u-buku" value={kode} onChange={setKode} options={buku.map((b) => ({ value: b.kode, label: `${b.kode} — ${b.nama}` }))} placeholder="— pilih buku —" />
        </Kolom>
        <Kolom id="u-tgl" label="Tanggal dokumen / transaksi" wajib>
          <Input id="u-tgl" type="date" value={tanggal} max={hariIni()} onChange={(e) => setTanggal(e.target.value)} />
        </Kolom>
      </div>
      <IsianMeta f={meta} set={setMeta} pre="u" />
      <Kolom id="u-file" label="Berkas scan (PDF, JPG, PNG · maks 8 MB)" wajib>
        <Input id="u-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => pilihBerkas(e.target.files?.[0] ?? null)} />
        {file && <p className="text-muted-foreground text-xs">{file.name} · {ukuranTeks(file.size)}</p>}
      </Kolom>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button onClick={simpan} disabled={sibuk}>{sibuk ? "Mengunggah…" : "Unggah"}</Button>
      </div>
    </Bingkai>
  );
}

// ---------------------------------------------------------------- detail / ubah / hapus

export function DetailDialog({ awal, bolehUbah, bolehHapus, onClose, onBerubah }: {
  awal: Arsip; bolehUbah: boolean; bolehHapus: boolean; onClose: () => void; onBerubah: () => void;
}) {
  const [meta, setMeta] = useState<Meta>(metaAwal(awal));
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const simpan = async () => {
    if (!meta.judul.trim()) { setErr("Judul dokumen wajib diisi."); return; }
    setSibuk(true); setErr(null);
    try { await kirim(`/api/arsip-dokumen/${awal.id}`, json("PATCH", meta)); onBerubah(); }
    catch (e) { setErr((e as Error).message); setSibuk(false); }
  };
  const hapus = () => confirm({
    title: `Hapus ${awal.nomor}?`,
    description: "Dokumen hilang dari daftar dan telusur. Nomornya tetap terpakai (tidak diberikan ke dokumen lain); berkas di Drive tidak dihapus.",
    confirmLabel: "Hapus", destructive: true,
  }, async () => {
    setSibuk(true); setErr(null);
    try { await kirim(`/api/arsip-dokumen/${awal.id}`, { method: "DELETE" }); onBerubah(); }
    catch (e) { setErr((e as Error).message); setSibuk(false); }
  });

  return (
    <Bingkai judul={awal.nomor} deskripsi={`${awal.buku_nama} · ${tgl(awal.tanggal_dokumen)}`} onClose={onClose}>
      <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="min-w-0 truncate">{awal.nama_asli} <span className="text-muted-foreground">· {ukuranTeks(awal.ukuran)}</span></span>
        <a href={`/api/arsip-dokumen/${awal.id}/berkas`} target="_blank" rel="noopener noreferrer" className="text-primary text-sm font-medium underline-offset-2 hover:underline">Buka berkas</a>
      </div>
      <p className="text-muted-foreground text-xs">
        Diunggah {awal.diunggah_oleh ?? "—"} · {tgl(awal.diunggah_at)}
        {awal.diubah_at && <> · diubah {awal.diubah_oleh ?? "—"} · {tgl(awal.diubah_at)}</>}
      </p>
      {bolehUbah ? <IsianMeta f={meta} set={setMeta} pre="d" /> : (
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Baca l="Judul" v={awal.judul} /><Baca l="Akun / bank" v={awal.akun} /><Baca l="Lokasi hardfile" v={awal.lokasi_fisik} />
          {REF.map((r) => <Baca key={r.key} l={r.label} v={awal[r.key]} />)}
          <Baca l="Keterangan" v={awal.keterangan} />
        </dl>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}
      <div className="flex justify-between gap-2 pt-1">
        <div>{bolehHapus && <Button variant="destructive" onClick={hapus} disabled={sibuk}>Hapus</Button>}</div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={sibuk}>Tutup</Button>
          {bolehUbah && <Button onClick={simpan} disabled={sibuk}>{sibuk ? "Menyimpan…" : "Simpan"}</Button>}
        </div>
      </div>
      {dialog}
    </Bingkai>
  );
}

function Baca({ l, v }: { l: string; v: string | null }) {
  return <div><dt className="text-muted-foreground text-xs">{l}</dt><dd>{v || "—"}</dd></div>;
}

// ---------------------------------------------------------------- kode buku (admin)

export function BukuDialog({ awal, onClose, onTersimpan }: { awal: Buku | null; onClose: () => void; onTersimpan: () => void }) {
  const [kode, setKode] = useState(awal?.kode ?? "");
  const [nama, setNama] = useState(awal?.nama ?? "");
  const [ket, setKet] = useState(awal?.keterangan ?? "");
  const [aktif, setAktif] = useState(awal?.aktif ?? true);
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const simpan = async () => {
    setSibuk(true); setErr(null);
    try { await kirim("/api/arsip-dokumen/buku", json("POST", { kode, nama, keterangan: ket, aktif })); onTersimpan(); }
    catch (e) { setErr((e as Error).message); setSibuk(false); }
  };
  return (
    <Bingkai judul={awal ? `Kode buku ${awal.kode}` : "Tambah kode buku"} onClose={onClose}
      deskripsi={awal ? "Kode tidak bisa diganti karena sudah melekat di nomor dokumen." : "2–10 huruf besar/angka, diawali huruf. Tidak bisa diganti setelah disimpan."}>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Kolom id="b-kode" label="Kode" wajib>
          <Input id="b-kode" value={kode} disabled={!!awal} maxLength={10} className="font-mono uppercase"
            onChange={(e) => setKode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="BKK" />
        </Kolom>
        <Kolom id="b-nama" label="Nama" wajib>
          <Input id="b-nama" value={nama} onChange={(e) => setNama(e.target.value)} maxLength={80} placeholder="Bukti Kas Keluar" />
        </Kolom>
      </div>
      <Kolom id="b-ket" label="Keterangan">
        <Input id="b-ket" value={ket} onChange={(e) => setKet(e.target.value)} maxLength={200} />
      </Kolom>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={aktif} onCheckedChange={(v) => setAktif(Boolean(v))} />
        Aktif (bisa dipilih saat unggah)
      </label>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={sibuk}>Batal</Button>
        <Button onClick={simpan} disabled={sibuk}>{sibuk ? "Menyimpan…" : "Simpan"}</Button>
      </div>
    </Bingkai>
  );
}
