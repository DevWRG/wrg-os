"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { kirim, type AmOpsi, type BarisAm, type ItemKampanye, type Kampanye } from "./types";

export interface OpsiKampanye { brands: string[]; am: AmOpsi[] }

interface Isian {
  nama: string;
  deskripsi: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  satuan_qty: string;
  brands: string[];
  items: ItemKampanye[];
  target: Record<string, { rp: string; qty: string }>;
}

const kosong = (): Isian => ({ nama: "", deskripsi: "", tanggal_mulai: "", tanggal_selesai: "", satuan_qty: "", brands: [], items: [], target: {} });

function dariKampanye(k: Kampanye, targets: BarisAm[]): Isian {
  const target: Isian["target"] = {};
  for (const t of targets) {
    if (t.target_rp > 0 || t.target_qty != null) {
      target[t.am_id] = { rp: t.target_rp ? String(Math.round(t.target_rp)) : "0", qty: t.target_qty == null ? "" : String(t.target_qty) };
    }
  }
  return {
    nama: k.nama, deskripsi: k.deskripsi ?? "", tanggal_mulai: k.tanggal_mulai, tanggal_selesai: k.tanggal_selesai,
    satuan_qty: k.satuan_qty ?? "", brands: k.brands, items: k.items, target,
  };
}

// Buat / ubah kampanye. Edit: target yang tampil = AM dalam scope pemanggil
// (HoD hanya mengatur AM cabang timnya; target AM lain dibiarkan apa adanya).
export function KampanyeFormDialog({ open, onClose, opsi, awal }: {
  open: boolean;
  onClose: () => void;
  opsi: OpsiKampanye;
  awal?: { kampanye: Kampanye; targets: BarisAm[] };
}) {
  const router = useRouter();
  const [f, setF] = useState<Isian>(() => (awal ? dariKampanye(awal.kampanye, awal.targets) : kosong()));
  const [brandBaru, setBrandBaru] = useState("");
  const [cari, setCari] = useState("");
  const [hasil, setHasil] = useState<ItemKampanye[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = <K extends keyof Isian>(k: K, v: Isian[K]) => setF((p) => ({ ...p, [k]: v }));

  function tambahBrand(b: string) {
    const v = b.trim();
    if (!v) return;
    const kanon = opsi.brands.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
    if (!f.brands.includes(kanon)) set("brands", [...f.brands, kanon]);
    setBrandBaru("");
  }

  function ketikCari(q: string) {
    setCari(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setHasil([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const d = await kirim<{ items: ItemKampanye[] }>(`/api/kampanye-item?q=${encodeURIComponent(q.trim())}`);
        setHasil(d.items);
      } catch { setHasil([]); }
    }, 300);
  }

  function setTarget(am: string, k: "rp" | "qty", v: string) {
    setF((p) => ({ ...p, target: { ...p.target, [am]: { rp: p.target[am]?.rp ?? "", qty: p.target[am]?.qty ?? "", [k]: v } } }));
  }

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        nama: f.nama, deskripsi: f.deskripsi, tanggal_mulai: f.tanggal_mulai, tanggal_selesai: f.tanggal_selesai,
        satuan_qty: f.satuan_qty, brands: f.brands, item_ids: f.items.map((i) => i.item_id),
        targets: Object.entries(f.target).map(([am_id, t]) => ({ am_id, target_rp: t.rp, target_qty: t.qty })),
      };
      if (awal) {
        await kirim(`/api/kampanye/${awal.kampanye.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        router.refresh();
        onClose();
      } else {
        const k = await kirim<Kampanye>("/api/kampanye", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        router.push(`/kampanye/${k.id}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const totalTarget = Object.values(f.target).reduce((s, t) => s + (Number(t.rp) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{awal ? `Ubah ${awal.kampanye.kode}` : "Buat kampanye"}</DialogTitle>
          <DialogDescription>
            Realisasi dihitung otomatis dari faktur & SO non-KSO yang item-nya termasuk brand/item di bawah, dalam periode kampanye. AM tidak perlu menandai apa pun.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="km-nama">Nama kampanye *</Label>
              <Input id="km-nama" value={f.nama} onChange={(e) => set("nama", e.target.value)} placeholder="mis. Vivachek 5000 box Q4" /></div>
            <div className="space-y-1"><Label htmlFor="km-mulai">Mulai *</Label>
              <Input id="km-mulai" type="date" value={f.tanggal_mulai} onChange={(e) => set("tanggal_mulai", e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="km-selesai">Selesai *</Label>
              <Input id="km-selesai" type="date" value={f.tanggal_selesai} onChange={(e) => set("tanggal_selesai", e.target.value)} /></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="km-desk">Keterangan</Label>
              <Textarea id="km-desk" rows={2} value={f.deskripsi} onChange={(e) => set("deskripsi", e.target.value)} placeholder="opsional — mekanisme promo, sasaran faskes, dsb." /></div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="km-brand">Brand</Label>
            <div className="flex gap-2">
              <Input id="km-brand" list="km-brand-opsi" value={brandBaru} onChange={(e) => setBrandBaru(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tambahBrand(brandBaru); } }} placeholder="ketik lalu Enter, mis. VIVACHEK" />
              <Button type="button" variant="outline" onClick={() => tambahBrand(brandBaru)}>Tambah</Button>
              <datalist id="km-brand-opsi">{opsi.brands.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.brands.map((b) => (
                <span key={b} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-sm">
                  {b}<button type="button" aria-label={`Hapus ${b}`} onClick={() => set("brands", f.brands.filter((x) => x !== b))}><X className="size-3.5" /></button>
                </span>
              ))}
              {!f.brands.length && <span className="text-muted-foreground text-xs">Belum ada brand.</span>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="km-item">Item tertentu (opsional)</Label>
            <p className="text-muted-foreground text-xs">
              Untuk item yang brand-nya belum terpetakan, atau kampanye satu produk. Bila diisi, <b>qty kampanye hanya dihitung dari item ini</b>.
            </p>
            <Input id="km-item" value={cari} onChange={(e) => ketikCari(e.target.value)} placeholder="cari nama / kode Accurate (min. 2 huruf)" />
            {hasil.length > 0 && (
              <div className="max-h-44 overflow-y-auto rounded-md border">
                {hasil.map((i) => (
                  <button key={i.item_id} type="button" disabled={f.items.some((x) => x.item_id === i.item_id)}
                    onClick={() => { set("items", [...f.items, i]); }}
                    className="hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm disabled:opacity-50">
                    <span>{i.nama} <span className="text-muted-foreground text-xs">{i.no}</span></span>
                    <span className="text-muted-foreground text-xs">{i.brand ?? "brand ?"}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {f.items.map((i) => (
                <span key={i.item_id} className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-sm">
                  {i.nama ?? i.no}<button type="button" aria-label={`Hapus ${i.nama ?? i.no}`} onClick={() => set("items", f.items.filter((x) => x.item_id !== i.item_id))}><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <Label>Target per AM</Label>
                <p className="text-muted-foreground text-xs">Rupiah netto (tanpa PPN, sama dengan Sales Analytics). Kosongkan AM yang tidak ikut.</p>
              </div>
              <div className="w-40 space-y-1"><Label htmlFor="km-satuan" className="text-xs">Satuan qty (opsional)</Label>
                <Input id="km-satuan" value={f.satuan_qty} onChange={(e) => set("satuan_qty", e.target.value)} placeholder="mis. box" /></div>
            </div>
            {opsi.am.length === 0 ? (
              <p className="text-muted-foreground text-sm">Tidak ada AM yang bisa Anda beri target.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-card sticky top-0">
                    <tr className="border-b text-left"><th className="px-3 py-1.5 font-medium">AM</th><th className="px-3 py-1.5 font-medium">Target Rp</th>
                      {f.satuan_qty && <th className="px-3 py-1.5 font-medium">Target {f.satuan_qty}</th>}</tr>
                  </thead>
                  <tbody>
                    {opsi.am.map((a) => (
                      <tr key={a.am_id} className="border-b last:border-0">
                        <td className="px-3 py-1">{a.nama}<span className="text-muted-foreground text-xs">{a.cabang ? ` · ${a.cabang}` : ""}</span></td>
                        <td className="px-3 py-1"><CurrencyInput value={f.target[a.am_id]?.rp ?? ""} onChange={(v) => setTarget(a.am_id, "rp", v)} /></td>
                        {f.satuan_qty && <td className="w-32 px-3 py-1"><Input type="number" min={0} value={f.target[a.am_id]?.qty ?? ""} onChange={(e) => setTarget(a.am_id, "qty", e.target.value)} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-right text-sm">Total target: <b className="tabular-nums">Rp {totalTarget.toLocaleString("id-ID")}</b></p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={simpan} disabled={busy || !f.nama.trim() || !f.tanggal_mulai || !f.tanggal_selesai || (!f.brands.length && !f.items.length)}>
            {busy ? "Menyimpan…" : awal ? "Simpan perubahan" : "Buat kampanye"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
