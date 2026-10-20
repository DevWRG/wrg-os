"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  LABEL_CEK, LABEL_KEPUTUSAN, LABEL_SUMBER, json, kirim, rp, rpJt,
  type Cek, type Keputusan, type Kelompok, type Opsi, type Param, type Permintaan, type Review,
} from "./types";

const hariIni = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

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

function Pilihan<T extends string>({ nilai, set, opsi }: { nilai: T | null; set: (v: T) => void; opsi: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opsi.map(([v, l]) => <Button key={v} type="button" size="sm" variant={nilai === v ? "default" : "outline"} onClick={() => set(v)}>{l}</Button>)}
    </div>
  );
}

// ---------------------------------------------------------------- catat / ubah permintaan

interface Sku { kode: string; nama: string; brand: string | null; kode_2025: string | null }

export function CatatDialog({ awal, opsi, bolehUbah, onClose, onTersimpan, onKelompokBaru }: {
  awal: Permintaan | null; opsi: Opsi; bolehUbah: boolean; onClose: () => void; onTersimpan: () => void; onKelompokBaru: () => void;
}) {
  const [f, setF] = useState({
    tanggal_minta: awal?.tanggal_minta ?? hariIni(), pengaju: awal?.pengaju ?? "", am_id: awal?.am_id ?? "",
    faskes_nama: awal?.faskes_nama ?? "", produk_diminta: awal?.produk_diminta ?? "", merek: awal?.merek ?? "",
    qty_bulan: awal?.qty_bulan == null ? "" : String(awal.qty_bulan), satuan: awal?.satuan ?? "",
    harga_satuan: awal?.harga_satuan == null ? "" : String(awal.harga_satuan), sumber: awal?.sumber ?? "wa", catatan: awal?.catatan ?? "",
  });
  const [cek, setCek] = useState<Cek>(awal?.cek_master ?? "belum_dicek");
  const [sku, setSku] = useState<{ kode: string; nama: string } | null>(awal?.sku_kode ? { kode: awal.sku_kode, nama: awal.sku_nama ?? awal.sku_kode } : null);
  const [kelompok, setKelompok] = useState(awal?.kelompok_id ? String(awal.kelompok_id) : "");
  const accountId = awal?.account_id ?? null;
  const [kandidat, setKandidat] = useState<string[] | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  // AM dipilih → pengaju ikut namanya (tetap boleh diketik untuk HoD/teknisi)
  const pilihAm = (v: string) => {
    const a = opsi.am.find((x) => x.am_id === v);
    setF({ ...f, am_id: v, pengaju: a ? a.nama : f.pengaju });
  };

  const simpan = async (paksaNama?: string) => {
    setSibuk(true); setErr(null);
    const body: Record<string, unknown> = {
      ...f, faskes_nama: paksaNama ?? f.faskes_nama, am_id: f.am_id || null, cek_master: cek, sku_kode: sku?.kode ?? null,
      kelompok_id: kelompok ? Number(kelompok) : null,
    };
    if (paksaNama) body.account_id = null;
    else if (awal && f.faskes_nama === awal.faskes_nama) body.account_id = accountId;
    try {
      if (awal) await kirim(`/api/permintaan-produk/${awal.id}`, json("PATCH", body));
      else await kirim("/api/permintaan-produk", json("POST", body));
      onTersimpan();
    } catch (e) {
      const k = ((e as { data?: { kandidat?: string[] } }).data?.kandidat) ?? null;
      setKandidat(k);
      setErr((e as Error).message);
    } finally { setSibuk(false); }
  };

  const bisaSimpan = !!f.produk_diminta.trim() && !!f.faskes_nama.trim() && !!f.pengaju.trim() && ((cek !== "ada" && cek !== "substitusi") || !!sku);
  const hanyaBaca = !!awal && !bolehUbah;
  return (
    <Bingkai judul={awal ? "Permintaan produk" : "Catat permintaan produk"}
      deskripsi="Tulis produk persis seperti yang diminta faskes. Cek ke master dulu: kalau ada produk kita yang setara, itu yang ditawarkan — log tetap dicatat."
      onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Produk yang diminta</Label><Input value={f.produk_diminta} onChange={isi("produk_diminta")} disabled={hanyaBaca} placeholder="mis. Reagen HbA1c untuk FIA" /></div>
        <div><Label>Merek (bila disebut)</Label><Input value={f.merek} onChange={isi("merek")} disabled={hanyaBaca} /></div>
        <div><Label>Tanggal diminta</Label><Input type="date" value={f.tanggal_minta} max={hariIni()} onChange={isi("tanggal_minta")} disabled={hanyaBaca} /></div>
        <div><Label>Faskes</Label><Input value={f.faskes_nama} onChange={(e) => { setF({ ...f, faskes_nama: e.target.value }); setKandidat(null); }} disabled={hanyaBaca} /></div>
        <div><Label>Sumber</Label>
          <Combobox value={f.sumber} onChange={(v) => setF({ ...f, sumber: v })} disabled={hanyaBaca}
            options={Object.entries(LABEL_SUMBER).map(([value, label]) => ({ value, label }))} />
        </div>
        <div><Label>AM (bila dari AM)</Label>
          <Combobox value={f.am_id} onChange={pilihAm} disabled={hanyaBaca} emptyOption="— bukan AM —"
            options={opsi.am.map((a) => ({ value: a.am_id, label: `${a.nama}${a.cabang ? ` · ${a.cabang}` : ""}` }))} />
        </div>
        <div><Label>Pengaju</Label><Input value={f.pengaju} onChange={isi("pengaju")} disabled={hanyaBaca} placeholder="nama yang menyampaikan" /></div>
        <div><Label>Qty per bulan</Label><Input inputMode="decimal" value={f.qty_bulan} onChange={isi("qty_bulan")} disabled={hanyaBaca} /></div>
        <div><Label>Satuan</Label><Input value={f.satuan} onChange={isi("satuan")} disabled={hanyaBaca} placeholder="test, kit, box…" /></div>
        <div className="sm:col-span-2"><Label>Harga per satuan (diminta / harga pasar)</Label><Input inputMode="numeric" value={f.harga_satuan} onChange={isi("harga_satuan")} disabled={hanyaBaca} /></div>
      </div>
      {kandidat && kandidat.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/50 bg-amber-500/5 p-2 text-sm">
          <div>Nama faskes cocok ke beberapa customer — pilih yang benar:</div>
          <div className="flex flex-wrap gap-1">
            {kandidat.map((n) => <Button key={n} size="sm" variant="outline" onClick={() => { setF({ ...f, faskes_nama: n }); setKandidat(null); }}>{n}</Button>)}
            <Button size="sm" variant="ghost" onClick={() => simpan(f.faskes_nama)}>Simpan sebagai calon pelanggan</Button>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border p-3">
        <Label>Cek ke master SKU</Label>
        <Pilihan nilai={cek} set={(v) => { setCek(v); if (v === "belum_dicek" || v === "belum_ada") setSku(null); }}
          opsi={(Object.keys(LABEL_CEK) as Cek[]).map((k) => [k, LABEL_CEK[k]])} />
        {(cek === "ada" || cek === "substitusi") && !hanyaBaca && <CariSku pilih={sku} setPilih={setSku} label={cek === "ada" ? "SKU yang sama di master" : "SKU pengganti yang ditawarkan"} />}
        {sku && <div className="text-sm">SKU: <b>{sku.nama}</b> <span className="text-muted-foreground text-xs">({sku.kode})</span></div>}
      </div>

      {(bolehUbah || !awal) && (
        <PilihKelompok opsi={opsi} nilai={kelompok} set={setKelompok} disabled={hanyaBaca} onBaru={onKelompokBaru} />
      )}
      <div><Label>Catatan</Label><Textarea value={f.catatan} onChange={isi("catatan")} disabled={hanyaBaca} /></div>
      {awal && <p className="text-muted-foreground text-xs">Dicatat {awal.dicatat_oleh} · {awal.hari_kerja_catat} hari kerja sesudah diminta{awal.terlambat ? " (lewat batas)" : ""}</p>}
      {err && <p className="text-destructive text-sm">{err}</p>}
      {!hanyaBaca && <Button disabled={!bisaSimpan || sibuk} onClick={() => simpan()}>{awal ? "Simpan perubahan" : "Catat"}</Button>}
    </Bingkai>
  );
}

function CariSku({ pilih, setPilih, label }: { pilih: { kode: string } | null; setPilih: (s: { kode: string; nama: string }) => void; label: string }) {
  const [q, setQ] = useState("");
  const [hasil, setHasil] = useState<Sku[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let batal = false;
    const t = setTimeout(() => {
      kirim<{ items: Sku[] }>(`/api/permintaan-produk/sku?q=${encodeURIComponent(q.trim())}`).then((x) => { if (!batal) setHasil(x.items); }).catch(() => {});
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [q]);
  const tampil = q.trim().length < 2 ? [] : hasil;
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input placeholder="Ketik nama produk, brand, atau kode…" value={q} onChange={(e) => setQ(e.target.value)} />
      {tampil.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded border text-sm">
          {tampil.map((s) => (
            <li key={s.kode}>
              <button type="button" onClick={() => setPilih({ kode: s.kode, nama: s.nama })}
                className={cn("hover:bg-accent w-full px-2 py-1 text-left", pilih?.kode === s.kode && "bg-accent")}>
                {s.nama} <span className="text-muted-foreground text-xs">{s.brand ? `${s.brand} · ` : ""}{s.kode_2025 ?? s.kode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PilihKelompok({ opsi, nilai, set, disabled, onBaru }: { opsi: Opsi; nilai: string; set: (v: string) => void; disabled: boolean; onBaru: () => void }) {
  const [baru, setBaru] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const buat = async () => {
    setErr(null);
    try {
      const r = await kirim<{ id: number }>("/api/permintaan-produk/kelompok", json("POST", { nama: baru }));
      set(String(r.id)); setBaru(""); onBaru();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label>Kelompok produk (gabungkan penulisan berbeda untuk produk yang sama)</Label>
      <Combobox value={nilai} onChange={set} disabled={disabled} emptyOption="— belum dikelompokkan —"
        options={opsi.kelompok.map((k) => ({ value: String(k.id), label: k.nama }))} />
      {!disabled && (
        <div className="flex gap-2">
          <Input placeholder="atau buat kelompok baru…" value={baru} onChange={(e) => setBaru(e.target.value)} />
          <Button type="button" variant="outline" disabled={!baru.trim()} onClick={buat}>Buat</Button>
        </div>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- usulan Komite PD

export function UsulDialog({ k, onClose, onTersimpan }: { k: Kelompok; onClose: () => void; onTersimpan: () => void }) {
  const [u, setU] = useState<Keputusan | null>(null);
  const [c, setC] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const simpan = async () => {
    setSibuk(true); setErr(null);
    try { await kirim("/api/permintaan-produk/review", json("POST", { kelompok_id: k.id, usulan: u, catatan: c })); onTersimpan(); }
    catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
  };
  return (
    <Bingkai judul={`Usulan Komite PD — ${k.nama}`} deskripsi="Angka saat ini dibekukan sebagai bahan review kuartal. Komite mengusulkan, Direksi memutus." onClose={onClose}>
      <p className="text-sm">{k.faskes_unik} faskes · {k.permintaan} permintaan · harga median {rp(k.harga_median)} · potensi {rpJt(k.potensi_tahun)}/tahun{k.kandidat ? " · memenuhi ambang kandidat" : " · di bawah ambang kandidat"}</p>
      <Pilihan nilai={u} set={setU} opsi={(Object.keys(LABEL_KEPUTUSAN) as Keputusan[]).map((x) => [x, LABEL_KEPUTUSAN[x]])} />
      <Label>Alasan (wajib)</Label>
      <Textarea value={c} onChange={(e) => setC(e.target.value)} placeholder="mis. 5 RS minta, harga pasar stabil, principal X siap; atau: substitusi kita sudah setara" />
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!u || !c.trim() || sibuk} onClick={simpan}>Simpan usulan</Button>
    </Bingkai>
  );
}

// ---------------------------------------------------------------- putusan Direksi

export function PutusDialog({ r, onClose, onTersimpan }: { r: Review; onClose: () => void; onTersimpan: () => void }) {
  const [p, setP] = useState<Keputusan | null>(r.usulan);
  const [c, setC] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const simpan = async () => {
    setSibuk(true); setErr(null);
    try { await kirim(`/api/permintaan-produk/review/${r.id}/putusan`, json("POST", { putusan: p, catatan: c })); onTersimpan(); }
    catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
  };
  return (
    <Bingkai judul={`Putusan Direksi — ${r.kelompok_nama}`} deskripsi={`${r.kuartal} · usulan Komite PD: ${LABEL_KEPUTUSAN[r.usulan]}. Putusan final, tidak bisa diubah dari layar.`} onClose={onClose}>
      <p className="text-sm">“{r.usulan_catatan}” — {r.usulan_oleh}</p>
      <Pilihan nilai={p} set={setP} opsi={(Object.keys(LABEL_KEPUTUSAN) as Keputusan[]).map((x) => [x, LABEL_KEPUTUSAN[x]])} />
      <Label>Alasan putusan (wajib)</Label>
      <Textarea value={c} onChange={(e) => setC(e.target.value)} />
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!p || !c.trim() || sibuk} onClick={simpan}>Simpan putusan</Button>
    </Bingkai>
  );
}

// ---------------------------------------------------------------- ambang

export function ParamDialog({ p, onClose, onTersimpan }: { p: Param; onClose: () => void; onTersimpan: () => void }) {
  const [f, setF] = useState({ kandidat_min_faskes: String(p.kandidat_min_faskes), kandidat_hari: String(p.kandidat_hari),
    kandidat_min_potensi: String(p.kandidat_min_potensi), sla_hari_kerja: String(p.sla_hari_kerja) });
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const simpan = async () => {
    setSibuk(true); setErr(null);
    try { await kirim("/api/permintaan-produk/param", json("PATCH", f)); onTersimpan(); }
    catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
  };
  return (
    <Bingkai judul="Ambang kandidat review" deskripsi="Angka final ditetapkan Direksi. Perubahan langsung berlaku di tab Analisa; usulan yang sudah dibuat tetap memakai angka saat diusulkan." onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label>Minimal faskes berbeda</Label><Input inputMode="numeric" value={f.kandidat_min_faskes} onChange={isi("kandidat_min_faskes")} /></div>
        <div><Label>Jendela hitung (hari)</Label><Input inputMode="numeric" value={f.kandidat_hari} onChange={isi("kandidat_hari")} /></div>
        <div><Label>Minimal potensi per tahun (Rp)</Label><Input inputMode="numeric" value={f.kandidat_min_potensi} onChange={isi("kandidat_min_potensi")} /></div>
        <div><Label>Batas pencatatan (hari kerja)</Label><Input inputMode="numeric" value={f.sla_hari_kerja} onChange={isi("sla_hari_kerja")} /></div>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={sibuk} onClick={simpan}>Simpan ambang</Button>
    </Bingkai>
  );
}
