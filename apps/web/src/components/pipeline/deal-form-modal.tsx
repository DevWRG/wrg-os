"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

// F1-SPT form deal (create + edit). Field whitelist selaras backend DEAL_EDITABLE.
// Create → POST /api/deals (stage awal Prospecting). Edit → PATCH /api/deals/:id.

export interface DealFormInit {
  deal_id?: string;
  customer_name?: string | null;
  facility_name?: string | null;
  brand?: string | null;
  product?: string | null;
  product_category?: string | null;
  estimate_amount?: number | null;
  coop_model?: string | null;
  cabang?: string | null;
  city?: string | null;
  province?: string | null;
  purchase_year?: number | null;
  pic_hod?: string | null;
  notes?: string | null;
}

const TEXT_FIELDS: { key: keyof DealFormInit; label: string; wide?: boolean }[] = [
  { key: "facility_name", label: "Nama Faskes", wide: true },
  { key: "customer_name", label: "Nama Customer", wide: true },
  { key: "brand", label: "Brand" },
  { key: "product", label: "Produk" },
  { key: "coop_model", label: "Model Kerjasama" },
  { key: "cabang", label: "Cabang" },
  { key: "city", label: "Kota" },
  { key: "province", label: "Provinsi" },
  { key: "pic_hod", label: "PIC HOD" },
];

const str = (v: unknown) => (v == null ? "" : String(v));

export function DealFormModal({ mode, deal, onClose }: {
  mode: "create" | "edit";
  deal?: DealFormInit;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    customer_name: str(deal?.customer_name),
    facility_name: str(deal?.facility_name),
    brand: str(deal?.brand),
    product: str(deal?.product),
    product_category: str(deal?.product_category),
    estimate_amount: deal?.estimate_amount != null ? String(deal.estimate_amount) : "",
    coop_model: str(deal?.coop_model),
    cabang: str(deal?.cabang),
    city: str(deal?.city),
    province: str(deal?.province),
    purchase_year: deal?.purchase_year != null ? String(deal.purchase_year) : "",
    pic_hod: str(deal?.pic_hod),
    notes: str(deal?.notes),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.customer_name.trim() && !form.facility_name.trim()) {
      setErr("Nama customer atau faskes wajib diisi");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const url = mode === "create" ? "/api/deals" : `/api/deals/${encodeURIComponent(deal!.deal_id!)}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body?.error || `gagal (${res.status})`); return; }
      router.refresh();
      onClose();
    } catch {
      setErr("koneksi gagal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-w-lg w-full max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{mode === "create" ? "Deal Baru" : "Edit Deal"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {err && <div className="mt-3 text-sm px-2 py-1 rounded bg-rose-100 text-rose-700">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mt-4">
          {TEXT_FIELDS.map((fld) => (
            <label key={fld.key} className={`text-sm ${fld.wide ? "col-span-2" : ""}`}>
              <span className="text-xs text-muted-foreground">{fld.label}</span>
              <input value={form[fld.key] ?? ""} onChange={(e) => set(fld.key, e.target.value)}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1" />
            </label>
          ))}
          <label className="text-sm">
            <span className="text-xs text-muted-foreground">Kategori</span>
            <select value={form.product_category} onChange={(e) => set("product_category", e.target.value)}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1">
              <option value="">—</option>
              <option value="IVD">IVD</option>
              <option value="Medical">Medical</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted-foreground">Estimasi Nilai (Rp)</span>
            <input type="number" inputMode="numeric" value={form.estimate_amount} onChange={(e) => set("estimate_amount", e.target.value)}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted-foreground">Tahun Beli</span>
            <input type="number" inputMode="numeric" value={form.purchase_year} onChange={(e) => set("purchase_year", e.target.value)}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1" />
          </label>
          <label className="text-sm col-span-2">
            <span className="text-xs text-muted-foreground">Catatan</span>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2}
              className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1" />
          </label>
        </div>

        {mode === "create" && (
          <p className="text-xs text-muted-foreground mt-3">Deal baru mulai di stage <b>Prospecting</b>. Pindahkan lewat drag di board.</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted">Batal</button>
          <button disabled={busy} onClick={submit}
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "menyimpan…" : mode === "create" ? "Buat Deal" : "Simpan"}
          </button>
        </div>
      </Card>
    </div>
  );
}
