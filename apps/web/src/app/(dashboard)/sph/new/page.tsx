"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Loader2,
  Minus,
  PackageSearch,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogPicker, type CatalogChoice } from "@/components/crm/catalog-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ambilJson, pesanRamah, rupiah, useToast } from "@/components/sph/sph-ui";
import { hitungBaris, ringkasSph } from "@/lib/sph-hitung";
import { cn } from "@/lib/utils";

// F15 — Buat SPH, dipandu 4 langkah: Customer → Produk → Syarat → Tinjau.
//
// Aturan yang DIPERTAHANKAN dari form lama:
//  · customer WAJIB dipilih dari katalog Accurate (CatalogPicker) — yang dikirim
//    hanya id-nya; nama di surat di-derive server dari mirror (repo/sph.ts);
//  · produk dipilih PERSIS dari Price Book (bukan ketik nama bebas);
//  · diskon ≤ diskon maks per SKU, qty bilangan bulat > 0 — dicek di layar
//    (lib/sph-hitung.ts) DAN diulang server.
// Setelah disimpan, SPH berstatus draft = langsung masuk antrean review HoD
// Business (tak ada status "draf pribadi" di sales_doc), jadi tombolnya jujur:
// "Simpan & ajukan ke HoD".

interface PricebookItem {
  id: number;
  kode: string | null;
  brand: string;
  nama: string;
  varian: string | null;
  kemasan: string | null;
  priceList: number;
  diskonMaks: number;
  hargaNett: number;
  jumlahHarga: number; // >1 = nama dipakai berulang, cek varian/kemasan
}

interface CartRow {
  item: PricebookItem;
  qty: number;
  diskonPersen: number;
}

interface Syarat {
  pembayaran: string;
  pengiriman: string;
  masaBerlaku: string;
  harga: string;
}

const LABEL_SYARAT: Record<keyof Syarat, { label: string; bantu: string }> = {
  pembayaran: { label: "Pembayaran", bantu: "mis. 30 hari setelah faktur diterima" },
  pengiriman: { label: "Pengiriman", bantu: "mis. Franco gudang customer" },
  masaBerlaku: { label: "Masa berlaku penawaran", bantu: "mis. 14 hari sejak tanggal penawaran" },
  harga: { label: "Keterangan harga", bantu: "mis. harga belum termasuk PPN" },
};
const KUNCI = Object.keys(LABEL_SYARAT) as (keyof Syarat)[];

const LANGKAH = [
  { n: 1, judul: "Customer" },
  { n: 2, judul: "Produk" },
  { n: 3, judul: "Syarat" },
  { n: 4, judul: "Tinjau" },
];

const pct = (f: number) => `${Math.round(f * 10000) / 100}%`;

export default function SphNewPage() {
  const router = useRouter();
  const { toast, node: toastNode } = useToast();
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<CatalogChoice | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<PricebookItem[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Syarat diisi dari default (Pengaturan SPH) dan boleh diubah per SPH di sini
  // maupun nanti di halaman detail selama belum disetujui.
  const [syaratDefault, setSyaratDefault] = useState<Syarat | null>(null);
  const [syarat, setSyarat] = useState<Syarat>({ pembayaran: "", pengiriman: "", masaBerlaku: "", harga: "" });

  useEffect(() => {
    let aktif = true;
    fetch("/api/sph/pengaturan", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (aktif && p?.syaratDefault) {
          setSyaratDefault(p.syaratDefault as Syarat);
          setSyarat(p.syaratDefault as Syarat);
        }
      })
      .catch(() => {});
    return () => {
      aktif = false;
    };
  }, []);

  // Cari Price Book — otomatis saat mengetik (jeda 300 ms); katalog awal
  // langsung tersedia saat langkah Produk dibuka.
  useEffect(() => {
    let aktif = true;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await ambilJson<{ rows?: PricebookItem[]; items?: PricebookItem[] }>(
          `/api/pricebook/items?q=${encodeURIComponent(q.trim())}&limit=20`,
        );
        if (!aktif) return;
        setResults(data.rows ?? data.items ?? []);
        setSearchError(null);
      } catch (e) {
        if (!aktif) return;
        const m = pesanRamah(e);
        setSearchError(/izin/.test(m) ? "Anda belum punya akses Price Book. Minta admin membuka menu Price Book untuk Anda." : m);
      } finally {
        if (aktif) setSearching(false);
      }
    }, 300);
    return () => {
      aktif = false;
      window.clearTimeout(t);
    };
  }, [q]);

  const diKeranjang = useMemo(() => new Set(cart.map((r) => r.item.id)), [cart]);

  function tambah(item: PricebookItem) {
    if (diKeranjang.has(item.id)) return;
    setCart((prev) => [...prev, { item, qty: 1, diskonPersen: 0 }]);
  }
  function ubah(id: number, patch: Partial<Pick<CartRow, "qty" | "diskonPersen">>) {
    setCart((prev) => prev.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));
  }
  function hapus(id: number) {
    setCart((prev) => prev.filter((r) => r.item.id !== id));
  }

  const baris = useMemo(
    () =>
      cart.map((r) => {
        const input = { priceList: r.item.priceList, diskonMaks: r.item.diskonMaks, qty: r.qty, diskonPersen: r.diskonPersen };
        return { ...r, input, hasil: hitungBaris(input) };
      }),
    [cart],
  );
  const ringkas = useMemo(() => ringkasSph(baris.map((b) => ({ ...b.input, hasil: b.hasil }))), [baris]);
  const adaKembar = cart.some((r) => r.item.jumlahHarga > 1);

  // Apa yang menahan tombol "Lanjut" di tiap langkah.
  const penahan: Record<number, string | null> = {
    1: customer ? null : "Pilih customer dulu",
    2: cart.length === 0 ? "Tambahkan minimal 1 produk" : ringkas.adaMasalah ? "Perbaiki qty/diskon yang ditandai merah" : null,
    3: KUNCI.some((k) => !syarat[k].trim()) ? "Lengkapi semua syarat" : null,
    4: null,
  };
  const bolehKe = (n: number) => LANGKAH.slice(0, n - 1).every((l) => !penahan[l.n]);

  async function simpan() {
    setSubmitError(null);
    if (!customer || cart.length === 0 || ringkas.adaMasalah) return;
    setSubmitting(true);
    try {
      const data = await ambilJson<{ id: string }>("/api/sph", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Cuma id customer yang dikirim — nama di-derive server dari mirror.
        body: JSON.stringify({
          customer_id: String(customer.id),
          items: cart.map((r) => ({
            pricelist_item_id: r.item.id,
            qty: r.qty,
            diskon_requested: Math.round(r.diskonPersen * 100) / 10000,
          })),
          syarat,
        }),
      });
      router.push(`/sph/${encodeURIComponent(data.id)}?baru=1`);
    } catch (e) {
      const m = pesanRamah(e, "Gagal menyimpan SPH.");
      setSubmitError(m);
      toast("gagal", "SPH belum tersimpan", m);
      setSubmitting(false);
    }
  }

  const nav = (ringkasMode: boolean) => (
    <Navigasi
      step={step}
      setStep={setStep}
      penahan={penahan[step]}
      submitting={submitting}
      onSimpan={() => void simpan()}
      ringkas={ringkasMode}
    />
  );

  return (
    <div className="space-y-5 p-4 pb-28 sm:p-6 lg:pb-6">
      {toastNode}
      <div className="min-w-0">
        <Link href="/sph" className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-xs">
          <ArrowLeft className="size-3.5" /> Daftar SPH
        </Link>
        <h1 className="text-2xl font-semibold">Buat SPH baru</h1>
        <p className="text-muted-foreground text-sm">Empat langkah singkat. Harga & batas diskon otomatis dari Price Book.</p>
      </div>

      {/* Stepper */}
      <nav aria-label="Langkah pembuatan SPH" className="bg-card rounded-xl border p-2 shadow-[var(--shadow-card)]">
        <ol className="grid grid-cols-4 gap-1">
          {LANGKAH.map((l) => {
            const aktif = step === l.n;
            const selesai = step > l.n;
            return (
              <li key={l.n}>
                <button
                  type="button"
                  disabled={!bolehKe(l.n)}
                  aria-current={aktif ? "step" : undefined}
                  onClick={() => setStep(l.n)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:justify-start",
                    aktif && "border-primary-dark bg-primary-soft text-foreground dark:border-primary",
                    !aktif && "text-muted-foreground hover:text-foreground border-transparent disabled:opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      selesai && "bg-primary text-primary-foreground",
                      aktif && "bg-primary-dark dark:bg-primary text-white dark:text-[var(--primary-foreground)]",
                      !selesai && !aktif && "border-border border",
                    )}
                  >
                    {selesai ? <Check className="size-3.5" strokeWidth={3} /> : l.n}
                  </span>
                  <span className="hidden sm:inline">{l.judul}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-1 text-center text-xs font-medium sm:hidden">
          Langkah {step} dari 4 · {LANGKAH[step - 1].judul}
        </p>
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {step === 1 && (
            // overflow-visible: dropdown CatalogPicker (position absolute) tak boleh terpotong Card.
            <Card className="overflow-visible">
              <CardHeader>
                <CardTitle>Untuk customer siapa?</CardTitle>
                <CardDescription>Cari nama faskes lalu pilih dari daftar katalog Accurate.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pb-2">
                <div className="max-w-xl">
                  <Label htmlFor="sph-customer" className="mb-1.5 block">
                    Customer
                  </Label>
                  <CatalogPicker
                    entity="customers"
                    value={customer}
                    onChange={setCustomer}
                    inputId="sph-customer"
                    placeholder="Ketik nama customer…"
                    required
                  />
                </div>
                {customer ? (
                  <div className="flex max-w-xl items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
                    <Building2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{customer.label}</span> terpilih
                    </span>
                  </div>
                ) : (
                  <p className="text-muted-foreground max-w-xl text-xs">
                    Nama di surat diambil dari master Accurate, bukan dari ketikan. Customer belum ada di daftar? Minta admin menyinkronkan
                    katalog customer.
                  </p>
                )}
                {/* ruang untuk dropdown pencarian customer */}
                <div className="h-48" aria-hidden />
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Tambahkan produk</CardTitle>
                  <CardDescription>Cari dari Price Book lalu klik Tambah. Harga list & batas diskon mengikuti katalog.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari nama produk, brand, atau kode…"
                      className="pl-9"
                      aria-label="Cari produk"
                    />
                    {searching && <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />}
                  </div>
                  {searchError ? (
                    <p className="text-destructive flex items-center gap-2 text-sm">
                      <CircleAlert className="size-4" /> {searchError}
                    </p>
                  ) : searching && results.length === 0 ? (
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : results.length === 0 ? (
                    <EmptyState icon={PackageSearch} title="Produk tidak ditemukan" description="Coba kata kunci lain, mis. brand atau kode." className="py-6" />
                  ) : (
                    <ul className="divide-border max-h-[22rem] divide-y overflow-y-auto rounded-lg border">
                      {results.map((it) => {
                        const ada = diKeranjang.has(it.id);
                        return (
                          <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{it.nama}</p>
                              <p className="text-muted-foreground truncate text-xs">
                                {[it.brand, it.varian, it.kemasan].filter(Boolean).join(" · ")}
                                {it.jumlahHarga > 1 && (
                                  <span className="text-amber-700 dark:text-amber-400"> · {it.jumlahHarga} varian bernama sama</span>
                                )}
                              </p>
                              <p className="text-muted-foreground text-xs tabular-nums sm:hidden">
                                {rupiah(it.priceList)} · maks {pct(it.diskonMaks)}
                              </p>
                            </div>
                            <div className="hidden text-right sm:block">
                              <p className="text-sm tabular-nums">{rupiah(it.priceList)}</p>
                              <p className="text-muted-foreground text-xs">diskon maks {pct(it.diskonMaks)}</p>
                            </div>
                            <Button size="sm" variant={ada ? "ghost" : "soft"} disabled={ada} onClick={() => tambah(it)} aria-label={`Tambah ${it.nama}`}>
                              {ada ? <Check /> : <Plus />}
                              {ada ? "Ditambah" : "Tambah"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Produk di SPH ({cart.length})</CardTitle>
                  <CardDescription>Atur jumlah dan diskon. Diskon tidak boleh melebihi batas tiap produk.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {cart.length === 0 ? (
                    <EmptyState icon={PackageSearch} title="Belum ada produk" description="Cari di atas lalu klik Tambah." className="py-6" />
                  ) : (
                    <ul className="space-y-3">
                      {baris.map((r) => (
                        <li
                          key={r.item.id}
                          className={cn(
                            "bg-card rounded-lg border p-3",
                            (r.hasil.masalahQty || r.hasil.masalahDiskon) && "border-destructive/50",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{r.item.nama}</p>
                              <p className="text-muted-foreground text-xs">
                                {[r.item.brand, r.item.kemasan].filter(Boolean).join(" · ")} · list {rupiah(r.item.priceList)}
                              </p>
                              {r.item.jumlahHarga > 1 && (
                                <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                  <TriangleAlert className="size-3.5 shrink-0" /> Nama ini dipakai {r.item.jumlahHarga} varian — pastikan kemasannya
                                  benar.
                                </p>
                              )}
                            </div>
                            <Button size="icon-sm" variant="ghost" onClick={() => hapus(r.item.id)} aria-label={`Hapus ${r.item.nama}`}>
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
                            <div>
                              <Label htmlFor={`qty-${r.item.id}`} className="mb-1 block text-xs">
                                Qty
                              </Label>
                              <div className="flex items-center">
                                <Button
                                  size="icon-sm"
                                  variant="outline"
                                  className="rounded-r-none"
                                  onClick={() => ubah(r.item.id, { qty: Math.max(1, (Number.isInteger(r.qty) ? r.qty : 1) - 1) })}
                                  aria-label="Kurangi qty"
                                >
                                  <Minus />
                                </Button>
                                <Input
                                  id={`qty-${r.item.id}`}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  step={1}
                                  className="h-7 w-16 rounded-none text-center tabular-nums"
                                  aria-invalid={!!r.hasil.masalahQty}
                                  value={Number.isNaN(r.qty) ? "" : r.qty}
                                  onChange={(e) => ubah(r.item.id, { qty: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                                />
                                <Button
                                  size="icon-sm"
                                  variant="outline"
                                  className="rounded-l-none"
                                  onClick={() => ubah(r.item.id, { qty: (Number.isInteger(r.qty) ? r.qty : 0) + 1 })}
                                  aria-label="Tambah qty"
                                >
                                  <Plus />
                                </Button>
                              </div>
                            </div>
                            <div>
                              <Label htmlFor={`disk-${r.item.id}`} className="mb-1 block text-xs">
                                Diskon <span className="text-muted-foreground font-normal">(maks {pct(r.item.diskonMaks)})</span>
                              </Label>
                              <div className="relative w-28">
                                <Input
                                  id={`disk-${r.item.id}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={r.item.diskonMaks * 100}
                                  step={0.5}
                                  className="h-7 pr-7 tabular-nums"
                                  aria-invalid={!!r.hasil.masalahDiskon}
                                  value={r.diskonPersen}
                                  onChange={(e) => ubah(r.item.id, { diskonPersen: e.target.value === "" ? 0 : Number(e.target.value) })}
                                />
                                <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">%</span>
                              </div>
                            </div>
                            <div className="col-span-2 text-right sm:col-span-1">
                              <p className="text-muted-foreground text-xs tabular-nums">
                                {rupiah(r.hasil.hargaNett)} × {Number.isInteger(r.qty) && r.qty > 0 ? r.qty : "–"}
                              </p>
                              <p className="font-semibold tabular-nums">{rupiah(r.hasil.jumlah)}</p>
                            </div>
                          </div>
                          {(r.hasil.masalahQty || r.hasil.masalahDiskon) && (
                            <p className="text-destructive mt-2 flex items-center gap-1 text-xs">
                              <CircleAlert className="size-3.5" /> {r.hasil.masalahDiskon ?? r.hasil.masalahQty}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {adaKembar && (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Ada produk bernama kembar. Admin Penawaran akan mengonfirmasi variannya sebelum SPH bisa di-approve.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {step === 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Syarat & ketentuan</CardTitle>
                <CardDescription>Sudah terisi dari syarat standar. Ubah bila customer ini butuh syarat khusus.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {KUNCI.map((k) => (
                    <div key={k}>
                      <Label htmlFor={`sph-syarat-${k}`} className="mb-1.5 block">
                        {LABEL_SYARAT[k].label}
                      </Label>
                      <Textarea
                        id={`sph-syarat-${k}`}
                        value={syarat[k]}
                        maxLength={300}
                        rows={2}
                        placeholder={LABEL_SYARAT[k].bantu}
                        aria-invalid={!syarat[k].trim()}
                        onChange={(e) => setSyarat({ ...syarat, [k]: e.target.value })}
                      />
                      {!syarat[k].trim() && <p className="text-destructive mt-1 text-xs">Wajib diisi</p>}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">Masih bisa diubah di halaman detail sampai SPH disetujui.</p>
                  {syaratDefault && KUNCI.some((k) => syarat[k] !== syaratDefault[k]) && (
                    <Button size="sm" variant="outline" onClick={() => setSyarat(syaratDefault)}>
                      <RotateCcw /> Kembalikan ke standar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {step === 4 && customer && (
            <Card>
              <CardHeader>
                <CardTitle>Tinjau sebelum disimpan</CardTitle>
                <CardDescription>Periksa sekali lagi. Produk & harga tidak bisa diubah setelah disimpan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border p-4 text-sm">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Surat Penawaran Harga · Draf</p>
                  <p className="mt-2">
                    Kepada Yth. <span className="font-semibold">{customer.label}</span>
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm">
                      <thead>
                        <tr className="text-muted-foreground border-b text-left text-xs">
                          <th className="py-1.5 pr-2 font-medium">Produk</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Diskon</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Nett/unit</th>
                          <th className="py-1.5 text-right font-medium">Jumlah</th>
                        </tr>
                      </thead>
                      <tbody>
                        {baris.map((r) => (
                          <tr key={r.item.id} className="border-b last:border-0">
                            <td className="py-1.5 pr-2">
                              {r.item.nama}
                              {r.item.kemasan && <span className="text-muted-foreground"> · {r.item.kemasan}</span>}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{r.qty}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{r.diskonPersen > 0 ? `${r.diskonPersen}%` : "–"}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{rupiah(r.hasil.hargaNett)}</td>
                            <td className="py-1.5 text-right tabular-nums">{rupiah(r.hasil.jumlah)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="text-sm">
                        <tr>
                          <td colSpan={4} className="pt-2 pr-2 text-right">
                            Subtotal
                          </td>
                          <td className="pt-2 text-right tabular-nums">{rupiah(ringkas.subtotal)}</td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="pr-2 text-right">
                            PPN 11%
                          </td>
                          <td className="text-right tabular-nums">{rupiah(ringkas.ppn)}</td>
                        </tr>
                        <tr className="font-semibold">
                          <td colSpan={4} className="pr-2 text-right">
                            Total
                          </td>
                          <td className="text-right tabular-nums">{rupiah(ringkas.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <dl className="mt-4 grid gap-x-4 gap-y-1.5 border-t pt-3 sm:grid-cols-[11rem_1fr]">
                    {KUNCI.map((k) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{LABEL_SYARAT[k].label}</dt>
                        <dd>{syarat[k]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="border-primary/40 bg-primary-soft flex gap-3 rounded-lg border px-3 py-2.5 text-sm">
                  <Send className="text-primary-dark dark:text-primary mt-0.5 size-4 shrink-0" />
                  <p>
                    Setelah disimpan, SPH <strong>langsung masuk antrean review HoD Business</strong>. Nomor surat diberikan saat approve
                    tahap 2, lalu SPH bisa dikirim ke customer.
                  </p>
                </div>
                {submitError && (
                  <p className="text-destructive flex items-start gap-2 text-sm">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" /> {submitError}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Ringkasan + navigasi langkah (lengket di desktop; bilah bawah di ponsel) */}
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <p className="text-muted-foreground text-xs">Customer</p>
                <p className={cn("font-medium", !customer && "text-muted-foreground font-normal italic")}>{customer?.label ?? "belum dipilih"}</p>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Subtotal ({cart.length} produk)</dt>
                  <dd className="tabular-nums">{rupiah(ringkas.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">PPN 11%</dt>
                  <dd className="tabular-nums">{rupiah(ringkas.ppn)}</dd>
                </div>
                {ringkas.hemat > 0 && (
                  <div className="flex justify-between gap-2 text-xs">
                    <dt className="text-muted-foreground">Total diskon</dt>
                    <dd className="text-emerald-700 tabular-nums dark:text-emerald-400">−{rupiah(ringkas.hemat)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2 border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{rupiah(ringkas.total)}</dd>
                </div>
              </dl>
              {nav(false)}
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Bilah bawah ponsel/tablet */}
      <div className="bg-card fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 shadow-[0_-4px_12px_rgb(15_23_42/0.08)] lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground truncate text-xs">{penahan[step] ?? `${cart.length} produk · total incl. PPN`}</p>
            <p className="truncate font-semibold tabular-nums">{rupiah(ringkas.total)}</p>
          </div>
          {nav(true)}
        </div>
      </div>
    </div>
  );
}

function Navigasi({
  step,
  setStep,
  penahan,
  submitting,
  onSimpan,
  ringkas,
}: {
  step: number;
  setStep: (n: number) => void;
  penahan: string | null;
  submitting: boolean;
  onSimpan: () => void;
  ringkas: boolean;
}) {
  const kembali =
    step > 1 ? (
      <Button variant="outline" onClick={() => setStep(step - 1)} disabled={submitting} aria-label="Kembali">
        <ArrowLeft />
        {ringkas ? null : "Kembali"}
      </Button>
    ) : null;
  const maju =
    step < 4 ? (
      <Button onClick={() => setStep(step + 1)} disabled={!!penahan} className={ringkas ? undefined : "flex-1"}>
        Lanjut <ArrowRight />
      </Button>
    ) : (
      <Button onClick={onSimpan} disabled={submitting || !!penahan} className={ringkas ? undefined : "flex-1"}>
        {submitting ? <Loader2 className="animate-spin" /> : <Send />}
        {submitting ? "Menyimpan…" : ringkas ? "Simpan & ajukan" : "Simpan & ajukan ke HoD"}
      </Button>
    );
  if (ringkas) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        {kembali}
        {maju}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {kembali}
        {maju}
      </div>
      {penahan && <p className="text-muted-foreground text-center text-xs">{penahan}</p>}
    </div>
  );
}
