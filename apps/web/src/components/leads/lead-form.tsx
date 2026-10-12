"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { BANT, BANT_LOLOS } from "./types";

// Isian lead — dipakai dialog tambah & dialog detail (mode ubah). Semua nilai
// disimpan sebagai string di state supaya input kosong tetap kosong (bukan 0).
export interface IsianLead {
  facility_name: string; city: string; kebutuhan: string; brand: string; product: string; product_category: string;
  estimate_amount: string; purchase_month: string; purchase_year: string;
  contact_name: string; contact_role: string; contact_phone: string; notes: string; source_detail: string;
  bant_budget: boolean; bant_authority: boolean; bant_need: boolean; bant_timeline: boolean;
}

export const ISIAN_KOSONG: IsianLead = {
  facility_name: "", city: "", kebutuhan: "", brand: "", product: "", product_category: "",
  estimate_amount: "", purchase_month: "", purchase_year: "", contact_name: "", contact_role: "", contact_phone: "",
  notes: "", source_detail: "", bant_budget: false, bant_authority: false, bant_need: false, bant_timeline: false,
};

/** Bentuk body API: string kosong → null, angka → number. */
export function keBody(f: IsianLead): Record<string, unknown> {
  const s = (v: string) => (v.trim() ? v.trim() : null);
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    facility_name: f.facility_name.trim(), city: s(f.city), kebutuhan: s(f.kebutuhan), brand: s(f.brand), product: s(f.product),
    product_category: s(f.product_category), estimate_amount: n(f.estimate_amount), purchase_month: n(f.purchase_month),
    purchase_year: n(f.purchase_year), contact_name: s(f.contact_name), contact_role: s(f.contact_role),
    contact_phone: s(f.contact_phone), notes: s(f.notes), source_detail: s(f.source_detail),
    bant_budget: f.bant_budget, bant_authority: f.bant_authority, bant_need: f.bant_need, bant_timeline: f.bant_timeline,
  };
}

export const selCls = "h-9 w-full rounded-md border border-border bg-card px-2 text-sm";
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function LeadForm({ f, setF, disabled }: { f: IsianLead; setF: (f: IsianLead) => void; disabled?: boolean }) {
  const skor = BANT.filter((b) => f[b.k]).length;
  const ubah = (k: keyof IsianLead) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="ld-faskes">Nama faskes *</Label>
        <Input id="ld-faskes" value={f.facility_name} onChange={ubah("facility_name")} disabled={disabled} placeholder="mis. RSUD dr Soedono" /></div>
      <div className="space-y-1"><Label htmlFor="ld-kota">Kota / kabupaten</Label>
        <Input id="ld-kota" value={f.city} onChange={ubah("city")} disabled={disabled} placeholder="dipakai untuk menentukan AM" /></div>
      <div className="space-y-1"><Label htmlFor="ld-detail">Detail sumber</Label>
        <Input id="ld-detail" value={f.source_detail} onChange={ubah("source_detail")} disabled={disabled} placeholder="mis. Pameran PATELKI 2026 / dirujuk dr. Andi" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="ld-butuh">Kebutuhan</Label>
        <Textarea id="ld-butuh" rows={2} value={f.kebutuhan} onChange={ubah("kebutuhan")} disabled={disabled} placeholder="alat/parameter yang dicari, volume tes, alat existing…" /></div>
      <div className="space-y-1"><Label htmlFor="ld-brand">Brand</Label>
        <Input id="ld-brand" value={f.brand} onChange={ubah("brand")} disabled={disabled} /></div>
      <div className="space-y-1"><Label htmlFor="ld-produk">Produk</Label>
        <Input id="ld-produk" value={f.product} onChange={ubah("product")} disabled={disabled} /></div>
      <div className="space-y-1"><Label htmlFor="ld-kat">Kategori</Label>
        <select id="ld-kat" className={selCls} value={f.product_category} onChange={ubah("product_category")} disabled={disabled}>
          <option value="">—</option><option value="IVD">IVD</option><option value="Medical">Medical</option>
        </select></div>
      <div className="space-y-1"><Label htmlFor="ld-nilai">Estimasi nilai (Rp)</Label>
        <Input id="ld-nilai" inputMode="numeric" value={f.estimate_amount} onChange={(e) => setF({ ...f, estimate_amount: e.target.value.replace(/[^0-9]/g, "") })} disabled={disabled} /></div>
      <div className="space-y-1"><Label htmlFor="ld-bulan">Perkiraan bulan beli</Label>
        <select id="ld-bulan" className={selCls} value={f.purchase_month} onChange={ubah("purchase_month")} disabled={disabled}>
          <option value="">—</option>{BULAN.map((b, i) => <option key={b} value={i + 1}>{b}</option>)}
        </select></div>
      <div className="space-y-1"><Label htmlFor="ld-tahun">Tahun beli</Label>
        <Input id="ld-tahun" inputMode="numeric" value={f.purchase_year} onChange={(e) => setF({ ...f, purchase_year: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} disabled={disabled} placeholder="2027" /></div>
      <div className="space-y-1"><Label htmlFor="ld-kontak">Kontak di faskes</Label>
        <Input id="ld-kontak" value={f.contact_name} onChange={ubah("contact_name")} disabled={disabled} /></div>
      <div className="space-y-1"><Label htmlFor="ld-jab">Jabatan kontak</Label>
        <Input id="ld-jab" value={f.contact_role} onChange={ubah("contact_role")} disabled={disabled} placeholder="mis. Kepala Lab" /></div>
      <div className="space-y-1"><Label htmlFor="ld-hp">No. HP kontak</Label>
        <Input id="ld-hp" value={f.contact_phone} onChange={ubah("contact_phone")} disabled={disabled} /></div>

      <fieldset className="space-y-2 rounded-lg border p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-semibold">
          Kualifikasi BANT{" "}
          <span className={cn("ml-1 rounded px-1.5 py-0.5 text-xs font-semibold",
            skor >= BANT_LOLOS ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300")}>
            {skor}/4{skor >= BANT_LOLOS ? " · siap dikonversi" : ` · perlu ${BANT_LOLOS - skor} lagi`}
          </span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BANT.map((b) => (
            <label key={b.k} className="flex items-start gap-2 text-sm">
              <Checkbox className="mt-0.5" checked={f[b.k]} disabled={disabled} onCheckedChange={(v) => setF({ ...f, [b.k]: Boolean(v) })} />
              <span><span className="font-medium">{b.l}</span><span className="text-muted-foreground block text-xs">{b.d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1 sm:col-span-2"><Label htmlFor="ld-cat">Catatan</Label>
        <Textarea id="ld-cat" rows={2} value={f.notes} onChange={ubah("notes")} disabled={disabled} /></div>
    </div>
  );
}
