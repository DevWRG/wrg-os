"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";

// F1-SPT form deal (create + edit). Field whitelist selaras backend DEAL_EDITABLE.
// Create → POST /api/deals (stage awal Prospecting). Edit → PATCH /api/deals/:id.
// Estimasi Nilai = QTY/test per-bulan × harga per unit (backend authoritative).

export interface DealFormInit {
  deal_id?: string;
  customer_name?: string | null;
  facility_name?: string | null;
  brand?: string | null;
  product?: string | null;
  product_category?: string | null;
  estimate_amount?: number | null;
  qty_num?: number | null;
  unit_price?: number | null;
  coop_model?: string | null;
  cabang?: string | null;
  city?: string | null;
  province?: string | null;
  purchase_year?: number | null;
  pic_hod?: string | null;
  notes?: string | null;
}

const str = (v: unknown) => (v == null ? "" : String(v));
const rp = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
const uniqSorted = (arr: (string | null | undefined)[]) =>
  [...new Set(arr.filter((x): x is string => !!x && x.trim() !== ""))].sort((a, b) => a.localeCompare(b));

const INPUT_CLS = "mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1";
function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

// Combobox ringan: input bebas + daftar opsi ter-filter. Nilai = teks bebas
// (boleh di luar opsi, mis. brand baru). Klik opsi → set nilai.
function Combo({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const q = value.trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.toLowerCase().includes(q)) : options).slice(0, 50);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1" />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-card shadow-md">
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              className="block w-full truncate px-2 py-1 text-left text-sm hover:bg-muted">
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DealFormModal({ mode, deal, onClose, brands = [], cabangs = [] }: {
  mode: "create" | "edit";
  deal?: DealFormInit;
  onClose: () => void;
  brands?: string[];
  cabangs?: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    customer_name: str(deal?.customer_name),
    facility_name: str(deal?.facility_name),
    brand: str(deal?.brand),
    product: str(deal?.product),
    product_category: str(deal?.product_category),
    qty_num: deal?.qty_num != null ? String(deal.qty_num) : "",
    unit_price: deal?.unit_price != null ? String(deal.unit_price) : "",
    coop_model: str(deal?.coop_model),
    cabang: str(deal?.cabang),
    city: str(deal?.city),
    province: str(deal?.province),
    purchase_year: deal?.purchase_year != null ? String(deal.purchase_year) : "",
    pic_hod: str(deal?.pic_hod),
    notes: str(deal?.notes),
  }));
  const [products, setProducts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Ambil katalog produk Accurate untuk dropdown Produk.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/products");
        const data = await res.json().catch(() => ({}));
        const names = Array.isArray(data?.rows)
          ? uniqSorted((data.rows as { name?: string | null }[]).map((r) => r.name))
          : [];
        if (alive) setProducts(names);
      } catch {
        if (alive) setProducts([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Estimasi = qty × harga bila keduanya terisi; else fallback estimate tersimpan.
  const qtyN = Number(form.qty_num);
  const priceN = Number(form.unit_price);
  const computed =
    form.qty_num !== "" && form.unit_price !== "" && Number.isFinite(qtyN) && Number.isFinite(priceN)
      ? qtyN * priceN
      : deal?.estimate_amount ?? null;

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

  const inputCls = INPUT_CLS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-w-lg w-full max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{mode === "create" ? "Deal Baru" : "Edit Deal"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {err && <div className="mt-3 text-sm px-2 py-1 rounded bg-rose-100 text-rose-700">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="text-sm col-span-2"><Lbl>Nama Faskes</Lbl>
            <input value={form.facility_name} onChange={(e) => set("facility_name", e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm col-span-2"><Lbl>Nama Customer</Lbl>
            <input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} className={inputCls} />
          </label>

          <label className="text-sm"><Lbl>Brand</Lbl>
            <Combo value={form.brand} onChange={(v) => set("brand", v)} options={brands} placeholder="cari / ketik brand…" />
          </label>
          <label className="text-sm"><Lbl>Produk</Lbl>
            <Combo value={form.product} onChange={(v) => set("product", v)} options={products} placeholder="cari produk Accurate…" />
          </label>

          <label className="text-sm"><Lbl>Model Kerjasama</Lbl>
            <select value={form.coop_model} onChange={(e) => set("coop_model", e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="KSO">KSO</option>
              <option value="Sale">Sale</option>
            </select>
          </label>
          <label className="text-sm"><Lbl>Cabang</Lbl>
            <select value={form.cabang} onChange={(e) => set("cabang", e.target.value)} className={inputCls}>
              <option value="">—</option>
              {uniqSorted(cabangs).map((c) => <option key={c} value={c}>{c}</option>)}
              {form.cabang && !cabangs.includes(form.cabang) && <option value={form.cabang}>{form.cabang}</option>}
            </select>
          </label>

          <label className="text-sm"><Lbl>Kota</Lbl>
            <input value={form.city} onChange={(e) => set("city", e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm"><Lbl>Provinsi</Lbl>
            <input value={form.province} onChange={(e) => set("province", e.target.value)} className={inputCls} />
          </label>

          <label className="text-sm"><Lbl>PIC HOD</Lbl>
            <input value={form.pic_hod} onChange={(e) => set("pic_hod", e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm"><Lbl>Kategori</Lbl>
            <select value={form.product_category} onChange={(e) => set("product_category", e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="IVD">IVD</option>
              <option value="Medical">Medical</option>
            </select>
          </label>

          <label className="text-sm"><Lbl>QTY / Test per-bulan</Lbl>
            <input type="number" inputMode="numeric" value={form.qty_num} onChange={(e) => set("qty_num", e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm"><Lbl>Harga per Test/Unit (Rp)</Lbl>
            <input type="number" inputMode="numeric" value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} className={inputCls} />
          </label>

          <div className="text-sm">
            <Lbl>Estimasi Nilai (Rp)</Lbl>
            <div className="mt-0.5 rounded-md bg-muted px-2 py-1 font-medium tabular-nums">
              {computed != null ? rp(computed) : "—"}
            </div>
            <span className="text-[11px] text-muted-foreground">QTY × Harga (otomatis)</span>
          </div>
          <label className="text-sm"><Lbl>Tahun Beli</Lbl>
            <input type="number" inputMode="numeric" value={form.purchase_year} onChange={(e) => set("purchase_year", e.target.value)} className={inputCls} />
          </label>

          <label className="text-sm col-span-2"><Lbl>Catatan</Lbl>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={inputCls} />
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
