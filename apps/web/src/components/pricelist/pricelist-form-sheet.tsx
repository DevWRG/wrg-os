"use client";

import { useState } from "react";
import { Award, Calculator, ChevronDown, MapPin, Package, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { derivePricing, formatRupiah, num, type PricelistRow } from "@/lib/pricelist";

export interface ProductOption {
  id: string;
  no: string | null;
  name: string | null;
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const toPctStr = (frac: number) => String(+(frac * 100).toFixed(2));

// Input angka bulat berformat ribuan (id-ID) di tampilan, simpan digit mentah.
function GroupedInput({
  id, value, onChange, prefix,
}: { id: string; value: string; onChange: (raw: string) => void; prefix?: string }) {
  const raw = value.replace(/\D/g, "");
  const display = raw === "" ? "" : Number(raw).toLocaleString("id-ID");
  const input = (
    <Input
      id={id}
      inputMode="numeric"
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      className={prefix ? "pl-9" : undefined}
    />
  );
  if (!prefix) return input;
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">{prefix}</span>
      {input}
    </div>
  );
}

function PercentInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="pr-7" />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">%</span>
    </div>
  );
}

function Section({
  icon: Icon, title, desc, children,
}: { icon: typeof Package; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {desc && <p className="text-muted-foreground -mt-2 text-xs">{desc}</p>}
      {children}
    </section>
  );
}

function PreviewRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={muted ? "text-primary/70 text-xs" : "text-primary/80 text-xs"}>{label}</span>
      <span className="text-primary/90 text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function PricelistFormDialog({
  open, onOpenChange, products, initial, canPublish, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ProductOption[];
  initial?: PricelistRow | null;
  canPublish: boolean;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {open ? (
          <PricelistFormBody
            products={products}
            initial={initial ?? null}
            canPublish={canPublish}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PricelistFormBody({
  products, initial, canPublish, onOpenChange, onSaved,
}: {
  products: ProductOption[];
  initial: PricelistRow | null;
  canPublish: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState(initial?.product_id ?? "");
  const [hpp, setHpp] = useState(initial ? String(num(initial.hpp)) : "0");
  const [margin, setMargin] = useState(initial ? toPctStr(num(initial.margin_pct)) : "0");
  const [diskon, setDiskon] = useState(initial ? toPctStr(num(initial.diskon_pct)) : "0");
  const [wrg, setWrg] = useState(initial ? toPctStr(num(initial.pct_wrg)) : "0");
  const [promosi, setPromosi] = useState(initial ? toPctStr(num(initial.pct_promosi)) : "0");
  const [hodSales, setHodSales] = useState(initial ? toPctStr(num(initial.pct_hod_sales)) : "0");
  const [totalPoint, setTotalPoint] = useState(initial ? String(initial.total_point) : "0");
  const [minPts, setMinPts] = useState(initial ? String(initial.min_incentive_pts) : "0");
  const [maxPts, setMaxPts] = useState(initial ? String(initial.max_incentive_pts) : "0");
  const [minRedemption, setMinRedemption] = useState(initial ? String(initial.min_redemption) : "0");
  const [cutoffDays, setCutoffDays] = useState(initial ? String(initial.cutoff_days) : "0");
  const [west, setWest] = useState(initial?.west_area_confirmation ?? false);
  const [east, setEast] = useState(initial?.east_area_confirmation ?? false);
  // Field lanjutan (insentif/loyalty) selalu collapse default agar fokus ke inti.
  const [showAdvanced, setShowAdvanced] = useState(false);

  const pct = (s: string) => num(s) / 100;
  const d = derivePricing(num(hpp), pct(margin), pct(diskon));
  // Tanda bila ada isi di bagian loyalty (untuk badge "terisi" saat collapse).
  const loyaltyFilled =
    num(totalPoint) > 0 || num(minPts) > 0 || num(maxPts) > 0 || num(minRedemption) > 0;

  async function run(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "operasi gagal");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { setError("Produk wajib dipilih"); return; }
    void run(() =>
      fetch("/api/pricelist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          hpp: num(hpp),
          margin_pct: pct(margin),
          diskon_pct: pct(diskon),
          pct_wrg: pct(wrg),
          pct_promosi: pct(promosi),
          pct_hod_sales: pct(hodSales),
          total_point: Math.trunc(num(totalPoint)),
          min_incentive_pts: Math.trunc(num(minPts)),
          max_incentive_pts: Math.trunc(num(maxPts)),
          min_redemption: Math.trunc(num(minRedemption)),
          cutoff_days: Math.trunc(num(cutoffDays)),
          west_area_confirmation: west,
          east_area_confirmation: east,
        }),
      }),
    );
  }

  const publish = () =>
    void run(() => fetch("/api/pricelist/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [initial!.id] }) }));
  const unpublish = () =>
    void run(() => fetch("/api/pricelist/unpublish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [initial!.id] }) }));
  const remove = () => {
    if (!confirm("Hapus baris pricelist ini?")) return;
    void run(() => fetch(`/api/pricelist?id=${encodeURIComponent(initial!.id)}`, { method: "DELETE" }));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {editing ? "Detail / Edit Pricelist" : "Tambah Pricelist"}
          {editing && (
            <Badge variant={initial.status === "published" ? "secondary" : "outline"}>
              {initial.status === "published" ? "Published" : "Draft"}
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription>
          Isi <strong>Harga Principal</strong>, <strong>Margin</strong>, dan <strong>Diskon</strong> — harga jual
          otomatis terhitung di panel kanan.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="grid gap-x-6 gap-y-6 sm:grid-cols-[1fr_18rem]">
          {/* ── Kiri: input inti + lanjutan (collapsible) ── */}
          <div className="min-w-0 space-y-6">
            <Section icon={Package} title="Produk">
              {editing ? (
                <div className="bg-muted/40 flex flex-col gap-1 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono">{initial.product_no ?? "—"}</Badge>
                    {initial.product_category && <Badge variant="secondary">{initial.product_category}</Badge>}
                  </div>
                  <p className="truncate text-sm font-medium" title={initial.product_name ?? ""}>{initial.product_name ?? "—"}</p>
                  {initial.product_avg_price && (
                    <p className="text-muted-foreground text-xs">Harga Avg Accurate: {formatRupiah(num(initial.product_avg_price))} (referensi)</p>
                  )}
                </div>
              ) : (
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-product">Pilih produk *</Label>
                  <select id="pl-product" className={selectClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">— pilih produk —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{[p.no, p.name].filter(Boolean).join(" · ") || p.id}</option>
                    ))}
                  </select>
                </div>
              )}
            </Section>

            <Section icon={Calculator} title="Harga & Margin" desc="Tiga angka ini menentukan harga jual.">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5 sm:col-span-3">
                  <Label htmlFor="pl-hpp">Harga Principal / HPP</Label>
                  <GroupedInput id="pl-hpp" value={hpp} onChange={setHpp} prefix="Rp" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-margin">Margin</Label>
                  <PercentInput id="pl-margin" value={margin} onChange={setMargin} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-diskon">Diskon</Label>
                  <PercentInput id="pl-diskon" value={diskon} onChange={setDiskon} />
                </div>
              </div>
            </Section>

            <Section icon={Award} title="Insentif" desc="Alokasi persentase di atas Price List.">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-wrg">WRG</Label>
                  <PercentInput id="pl-wrg" value={wrg} onChange={setWrg} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-promosi">Promosi</Label>
                  <PercentInput id="pl-promosi" value={promosi} onChange={setPromosi} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-hod">HOD Sales</Label>
                  <PercentInput id="pl-hod" value={hodSales} onChange={setHodSales} />
                </div>
              </div>
            </Section>

            {/* Loyalty (opsional) — disembunyikan agar tidak overwhelming */}
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="hover:bg-muted/50 flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="text-muted-foreground size-4" />
                  Loyalty &amp; Poin
                  <span className="text-muted-foreground text-xs font-normal">(opsional)</span>
                  {!showAdvanced && loyaltyFilled && (
                    <Badge variant="secondary" className="text-[10px]">terisi</Badge>
                  )}
                </span>
                <ChevronDown className={`text-muted-foreground size-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
              </button>

              {showAdvanced && (
                <div className="pt-1">
                  <Section icon={Sparkles} title="Loyalty &amp; Poin">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="pl-tp">Total Point</Label>
                        <GroupedInput id="pl-tp" value={totalPoint} onChange={setTotalPoint} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="pl-minpts">Min Incentive Pts</Label>
                        <GroupedInput id="pl-minpts" value={minPts} onChange={setMinPts} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="pl-maxpts">Max Incentive Pts</Label>
                        <GroupedInput id="pl-maxpts" value={maxPts} onChange={setMaxPts} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="pl-minred">Min Redemption</Label>
                        <GroupedInput id="pl-minred" value={minRedemption} onChange={setMinRedemption} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="pl-cutoff">Cutoff Days</Label>
                        <GroupedInput id="pl-cutoff" value={cutoffDays} onChange={setCutoffDays} />
                      </div>
                    </div>
                  </Section>
                </div>
              )}
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>

          {/* ── Kanan: hero ringkasan harga (pinned) + konfirmasi area ── */}
          <aside className="h-fit space-y-4 sm:sticky sm:top-0">
            <div className="border-primary/25 from-primary/10 to-primary/5 space-y-3 rounded-xl border bg-gradient-to-b p-4">
              <div className="flex items-center gap-1.5">
                <Calculator className="text-primary size-3.5" />
                <p className="text-primary text-xs font-semibold tracking-wide uppercase">Ringkasan Harga</p>
              </div>
              {editing && initial.product_name && (
                <p className="text-muted-foreground truncate text-xs" title={initial.product_name}>{initial.product_name}</p>
              )}
              <div className="space-y-2">
                <PreviewRow label="Price List" value={formatRupiah(d.priceList)} />
                <PreviewRow label={`Diskon ${num(diskon)}%`} value={`− ${formatRupiah(d.valueDiskon)}`} muted />
                <PreviewRow label="Nett Price" value={formatRupiah(d.nettPrice)} />
              </div>
              <div className="border-primary/20 border-t pt-3">
                <p className="text-muted-foreground text-xs">Price + PPN · incl. PPN 11%</p>
                <p className="text-primary text-2xl leading-tight font-bold tabular-nums">{formatRupiah(d.pricePpn)}</p>
              </div>
            </div>

            <Section icon={MapPin} title="Konfirmasi Area" desc="Penanda kesiapan harga per wilayah.">
              <div className="grid gap-2">
                <label htmlFor="pl-west" className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5">
                  <span className="text-sm">West Area</span>
                  <Switch id="pl-west" checked={west} onCheckedChange={setWest} />
                </label>
                <label htmlFor="pl-east" className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5">
                  <span className="text-sm">East Area</span>
                  <Switch id="pl-east" checked={east} onCheckedChange={setEast} />
                </label>
              </div>
            </Section>
          </aside>
        </DialogBody>

        <DialogFooter>
          {editing && (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy} className="text-destructive sm:mr-auto">Hapus</Button>
          )}
          {editing && canPublish && initial.status === "draft" && (
            <Button type="button" variant="outline" onClick={publish} disabled={busy}>Publish</Button>
          )}
          {editing && canPublish && initial.status === "published" && (
            <Button type="button" variant="outline" onClick={unpublish} disabled={busy}>Unpublish</Button>
          )}
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
          <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </form>
    </>
  );
}
