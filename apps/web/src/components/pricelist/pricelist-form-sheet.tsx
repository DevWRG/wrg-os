"use client";

import { useState } from "react";
import { Award, Calculator, MapPin, Package, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

// Angka poin (bisa desimal) → format id-ID, maks 2 desimal.
const fmtPts = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

// Field turunan read-only (bergaya seperti input, latar redup).
function ReadonlyField({ value }: { value: string }) {
  return (
    <div className="bg-muted/40 text-muted-foreground flex h-9 items-center rounded-md border px-3 text-sm tabular-nums">
      {value}
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
  const [pending, setPending] = useState<{
    title: string;
    description?: string;
    confirmLabel: string;
    destructive?: boolean;
    action: () => void;
  } | null>(null);

  const [productId, setProductId] = useState(initial?.product_id ?? "");
  const [hpp, setHpp] = useState(initial ? String(num(initial.hpp)) : "0");
  const [margin, setMargin] = useState(initial ? toPctStr(num(initial.margin_pct)) : "0");
  const [diskon, setDiskon] = useState(initial ? toPctStr(num(initial.diskon_pct)) : "0");
  // Price List dari sumber (migrasi 076). Ikut di-state supaya edit manual TIDAK
  // menghapus angka hasil impor — kosongkan sendiri kalau mau kembali dihitung
  // dari margin.
  const [priceList, setPriceList] = useState(
    initial?.price_list == null ? "" : String(Math.round(num(initial.price_list))),
  );
  const [wrg, setWrg] = useState(initial ? toPctStr(num(initial.pct_wrg)) : "0");
  const [promosi, setPromosi] = useState(initial ? toPctStr(num(initial.pct_promosi)) : "0");
  const [hodSales, setHodSales] = useState(initial ? toPctStr(num(initial.pct_hod_sales)) : "0");
  const [minRedemption, setMinRedemption] = useState(initial ? String(initial.min_redemption) : "0");
  const [cutoffDays, setCutoffDays] = useState(initial ? String(initial.cutoff_days) : "0");
  const [west, setWest] = useState(initial?.west_area_confirmation ?? false);
  const [east, setEast] = useState(initial?.east_area_confirmation ?? false);

  const pct = (s: string) => num(s) / 100;
  // Total Point & Min/Max Incentive Pts DITURUNKAN (bukan input) — dari Nett WRG.
  const d = derivePricing(
    num(hpp), pct(margin), pct(diskon), pct(wrg), pct(promosi), pct(hodSales),
    priceList.trim() === "" ? null : num(priceList),
  );

  // Alokasi insentif belum diisi (ketiga pct = 0) ⇒ angka turunannya BUKAN "nol",
  // melainkan "belum ada". Nett WRG = margin PENUH, jadi Total Point terbaca
  // sebagai poin MAKSIMUM yang mungkin — angka yang tampak sudah jadi padahal
  // basisnya belum ditetapkan. Tampilkan "—" supaya tak terbaca sebagai data
  // final. Kolom pct-nya `NOT NULL DEFAULT 0` (migrasi 043) sehingga "belum
  // diisi" dan "sengaja 0%" memang tak terpisahkan di DB — lihat catatan di PR.
  const alokasiKosong = pct(wrg) === 0 && pct(promosi) === 0 && pct(hodSales) === 0;
  const rp = (n: number, kosong: boolean) => (kosong ? "—" : formatRupiah(n));
  const pts = (n: number) => (alokasiKosong ? "—" : fmtPts(n));

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

  const doSave = () =>
    void run(() =>
      fetch("/api/pricelist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          hpp: num(hpp),
          margin_pct: pct(margin),
          diskon_pct: pct(diskon),
          price_list: priceList.trim() === "" ? null : num(priceList),
          pct_wrg: pct(wrg),
          pct_promosi: pct(promosi),
          pct_hod_sales: pct(hodSales),
          // Diturunkan dari Nett WRG (lihat lib/pricelist derivePricing), bukan input.
          total_point: Math.round(d.totalPoint),
          min_incentive_pts: Math.round(d.minIncentivePts),
          max_incentive_pts: Math.round(d.maxIncentivePts),
          min_redemption: Math.trunc(num(minRedemption)),
          cutoff_days: Math.trunc(num(cutoffDays)),
          west_area_confirmation: west,
          east_area_confirmation: east,
        }),
      }),
    );
  const doPublish = () =>
    void run(() => fetch("/api/pricelist/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [initial!.id] }) }));
  const doUnpublish = () =>
    void run(() => fetch("/api/pricelist/unpublish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [initial!.id] }) }));
  const doRemove = () =>
    void run(() => fetch(`/api/pricelist?id=${encodeURIComponent(initial!.id)}`, { method: "DELETE" }));

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) { setError("Produk wajib dipilih"); return; }
    setPending({ title: "Simpan pricelist?", description: "Simpan perubahan pricelist ini?", confirmLabel: "Simpan", action: doSave });
  }
  const publish = () =>
    setPending({ title: "Publish pricelist?", description: "Harga akan tampil ke Account Manager.", confirmLabel: "Publish", action: doPublish });
  const unpublish = () =>
    setPending({ title: "Unpublish pricelist?", description: "Harga akan hilang dari tampilan Account Manager.", confirmLabel: "Unpublish", action: doUnpublish });
  const remove = () =>
    setPending({ title: "Hapus pricelist?", description: "Baris pricelist ini akan dihapus permanen.", confirmLabel: "Hapus", destructive: true, action: doRemove });

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
                <div className="grid gap-1.5 sm:col-span-3">
                  <Label htmlFor="pl-pricelist">Price List dari sumber (opsional)</Label>
                  <GroupedInput id="pl-pricelist" value={priceList} onChange={setPriceList} prefix="Rp" />
                  <p className="text-muted-foreground text-xs">
                    Kosongkan agar dihitung dari margin ({formatRupiah(num(hpp) && pct(margin) < 1 ? num(hpp) / (1 - pct(margin)) : num(hpp))}).
                    Diisi kalau sumber sudah membulatkan harganya.
                  </p>
                </div>
              </div>
            </Section>

            <Section icon={Sparkles} title="Loyalty &amp; Poin" desc="Total Point & Min/Max Incentive Pts dihitung otomatis dari Nett WRG.">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Total Point</Label>
                  <ReadonlyField value={pts(d.totalPoint)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Min Incentive Pts</Label>
                  <ReadonlyField value={pts(d.minIncentivePts)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Max Incentive Pts</Label>
                  <ReadonlyField value={pts(d.maxIncentivePts)} />
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

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>

          {/* ── Kanan: hero ringkasan harga (pinned) + konfirmasi area ── */}
          <aside className="h-fit space-y-4 sm:sticky sm:top-0 sm:border-l sm:pl-6">
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

            <Section icon={Award} title="Insentif" desc="Alokasi persentase dari margin. Value = Margin × %.">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="pl-wrg">WRG</Label>
                    <span className="text-muted-foreground text-xs tabular-nums">{rp(d.valueWrg, pct(wrg) === 0)}</span>
                  </div>
                  <PercentInput id="pl-wrg" value={wrg} onChange={setWrg} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="pl-promosi">Promosi</Label>
                    <span className="text-muted-foreground text-xs tabular-nums">{rp(d.valuePromosi, pct(promosi) === 0)}</span>
                  </div>
                  <PercentInput id="pl-promosi" value={promosi} onChange={setPromosi} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="pl-hod">HOD Sales</Label>
                    <span className="text-muted-foreground text-xs tabular-nums">{rp(d.valueHodSales, pct(hodSales) === 0)}</span>
                  </div>
                  <PercentInput id="pl-hod" value={hodSales} onChange={setHodSales} />
                </div>
                <div className="border-primary/20 flex items-baseline justify-between gap-2 border-t pt-2.5">
                  <span className="text-sm font-medium">Nett WRG</span>
                  <span className="text-sm font-semibold tabular-nums">{formatRupiah(d.nettWrg)}</span>
                </div>
              </div>
            </Section>

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

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(v) => { if (!v) setPending(null); }}
        title={pending?.title ?? ""}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel ?? "OK"}
        destructive={pending?.destructive}
        onConfirm={() => {
          const act = pending?.action;
          setPending(null);
          act?.();
        }}
      />
    </>
  );
}
