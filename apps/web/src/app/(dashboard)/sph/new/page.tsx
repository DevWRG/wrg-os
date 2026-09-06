"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CatalogPicker, type CatalogChoice } from "@/components/crm/catalog-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Customer dipilih dari katalog Accurate (`accurate_customer`) lewat
// CatalogPicker — komponen yang sama dipakai F22.
//
// Sebelumnya di sini ada dua kotak: dropdown "pilih dari deal existing" (sumber
// /api/customers) dan kotak "atau isi manual". Dua-duanya dilepas:
//   · /api/customers itu read-model dari tabel `deal`, `customer_id`-nya sering
//     NULL dan bukan FK sungguhan — jadi SPH tersimpan tanpa tautan ke customer
//     mana pun, dan namanya bisa beda ejaan dari master.
//   · kotak manual membuat nama bisa diketik ulang bebas SESUDAH memilih, jadi
//     id dan nama bisa bercerita berbeda dalam satu dokumen.
// Nama yang dipakai di surat sekarang di-derive server-side dari mirror
// (repo/sph.ts), jadi yang dikirim dari sini hanya id-nya.

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
  diskonRequested: number; // fraksi
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export default function SphNewPage() {
  const [customer, setCustomer] = useState<CatalogChoice | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<PricebookItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Sistem gak punya data syarat bayar/kirim di mana pun (gak ada kolom itu
  // di Price Book) — WAJIB diisi AM per quote, bukan di-default sistem
  // (beda customer bisa beda syarat, salah tebak lebih bahaya dari kosong).
  const [paymentTerms, setPaymentTerms] = useState("");
  const [shippingTerms, setShippingTerms] = useState("");
  const [validityDays, setValidityDays] = useState(14);

  const search = useCallback(async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/pricebook/items?q=${encodeURIComponent(q)}&limit=20`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal cari item");
      setResults(data.items ?? data.rows ?? []);
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, [q]);

  function addToCart(item: PricebookItem) {
    setCart((prev) => {
      if (prev.some((r) => r.item.id === item.id)) return prev; // sudah ada, jangan duplikat baris
      return [...prev, { item, qty: 1, diskonRequested: 0 }];
    });
  }

  function updateCartRow(id: number, patch: Partial<Pick<CartRow, "qty" | "diskonRequested">>) {
    setCart((prev) => prev.map((r) => (r.item.id === id ? { ...r, ...patch } : r)));
  }

  function removeFromCart(id: number) {
    setCart((prev) => prev.filter((r) => r.item.id !== id));
  }

  const computed = useMemo(
    () =>
      cart.map((r) => {
        const diskon = Math.min(Math.max(r.diskonRequested, 0), r.item.diskonMaks);
        const hargaNett = Math.round(r.item.priceList * (1 - diskon));
        const nettPpn = Math.round(hargaNett * 1.11);
        return { ...r, diskonEfektif: diskon, hargaNett, nettPpn, jumlah: hargaNett * r.qty };
      }),
    [cart],
  );
  const total = computed.reduce((acc, r) => acc + r.jumlah, 0);
  const totalPpn = computed.reduce((acc, r) => acc + r.nettPpn * r.qty, 0);

  async function submit() {
    setSubmitError(null);
    if (!customer) {
      setSubmitError("pilih customer dari katalog dulu");
      return;
    }
    if (cart.length === 0) {
      setSubmitError("tambah minimal 1 item");
      return;
    }
    if (!paymentTerms.trim() || !shippingTerms.trim()) {
      setSubmitError("isi syarat pembayaran & pengiriman dulu — beda customer bisa beda syarat, sistem tak bisa nebak");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/sph", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Cuma id yang dikirim: nama di surat di-derive server-side dari
        // accurate_customer (repo/sph.ts), jadi tak ada jalan nama menyimpang
        // dari master lewat payload.
        body: JSON.stringify({
          customer_id: String(customer.id),
          items: cart.map((r) => ({
            pricelist_item_id: r.item.id,
            qty: r.qty,
            diskon_requested: r.diskonRequested,
          })),
          terms: { paymentTerms, shippingTerms, validityDays },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal membuat SPH");
      setCreatedId(data.id as string);
      setCart([]);
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (createdId) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">SPH dibuat ✅</h1>
        <p className="text-muted-foreground">
          Draft SPH utk {customer?.label ?? "customer terpilih"} sudah tersimpan (status: draft). Lanjut review di
          halaman Sales Docs.
        </p>
        <div className="flex gap-2">
          <Link href="/sales-docs">
            <Button>Buka Sales Docs</Button>
          </Link>
          <Button variant="outline" onClick={() => setCreatedId(null)}>
            Buat SPH lain
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Buat SPH</h1>
        <p className="text-muted-foreground">
          F15 — pilih item PERSIS dari katalog Price Book (F142), bukan ketik nama bebas. Harga & floor
          otomatis dari katalog, diskon divalidasi ≤ diskon maks per SKU.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="max-w-lg">
            <Label htmlFor="sph-customer" className="mb-1 block text-xs">
              Customer *
            </Label>
            <CatalogPicker
              entity="customers"
              value={customer}
              onChange={setCustomer}
              inputId="sph-customer"
              placeholder="cari nama customer lalu pilih dari daftar…"
              required
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Wajib dipilih dari katalog Accurate — nama di surat diambil dari master, bukan dari yang diketik. Kalau
            customer-nya belum ada di daftar, sinkronkan katalog customer dulu.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cari item Price Book</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="cari nama produk/brand/kode…"
            />
            <Button onClick={() => void search()} disabled={searching}>
              {searching ? "Mencari…" : "Cari"}
            </Button>
          </div>
          {searchError && <p className="text-destructive text-sm">{searchError}</p>}
          {results.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Harga List</TableHead>
                  <TableHead>Diskon Maks</TableHead>
                  <TableHead>Nett Floor</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>
                      <div className="font-medium">{it.nama}</div>
                      <div className="text-muted-foreground text-xs">
                        {it.brand}
                        {it.varian ? ` · ${it.varian}` : ""}
                        {it.kemasan ? ` · ${it.kemasan}` : ""}
                        {it.jumlahHarga > 1 && (
                          <span className="text-amber-600"> · ⚠️ {it.jumlahHarga} varian nama sama, cek dulu</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{rupiah(it.priceList)}</TableCell>
                    <TableCell>{(it.diskonMaks * 100).toFixed(0)}%</TableCell>
                    <TableCell>{rupiah(it.hargaNett)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => addToCart(it)}>
                        + Tambah
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Item SPH ({cart.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {cart.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada item. Cari & tambah dari katalog di atas.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Diskon (%)</TableHead>
                    <TableHead>Harga Nett/Unit</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computed.map((r) => (
                    <TableRow key={r.item.id}>
                      <TableCell>{r.item.nama}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          className="w-20"
                          value={r.qty}
                          onChange={(e) => updateCartRow(r.item.id, { qty: Number(e.target.value) || 1 })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={r.item.diskonMaks * 100}
                            className="w-20"
                            value={Math.round(r.diskonRequested * 100)}
                            onChange={(e) =>
                              updateCartRow(r.item.id, { diskonRequested: (Number(e.target.value) || 0) / 100 })
                            }
                          />
                          <span className="text-muted-foreground text-xs">
                            % (maks {(r.item.diskonMaks * 100).toFixed(0)}%)
                          </span>
                        </div>
                        {r.diskonRequested > r.item.diskonMaks && (
                          <p className="text-destructive text-xs">
                            melebihi diskon maks — akan ditolak saat submit
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{rupiah(r.hargaNett)}</TableCell>
                      <TableCell>{rupiah(r.jumlah)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => removeFromCart(r.item.id)}>
                          Hapus
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end gap-6 text-sm">
                <div>
                  Subtotal Nett: <span className="font-medium">{rupiah(total)}</span>
                </div>
                <div>
                  PPN 11%: <span className="font-medium">{rupiah(totalPpn - total)}</span>
                </div>
                <div>
                  Total: <span className="font-medium">{rupiah(totalPpn)}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Syarat & Ketentuan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label className="mb-1 block text-xs">Syarat Pembayaran *</Label>
            <Input
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="mis. Net 30 hari setelah barang diterima"
            />
          </div>
          <div className="min-w-64 flex-1">
            <Label className="mb-1 block text-xs">Syarat Pengiriman *</Label>
            <Input
              value={shippingTerms}
              onChange={(e) => setShippingTerms(e.target.value)}
              placeholder="mis. FOB Surabaya, 3-5 hari kerja"
            />
          </div>
          <div className="w-36">
            <Label className="mb-1 block text-xs">Masa Berlaku (hari)</Label>
            <Input
              type="number"
              min={1}
              value={validityDays}
              onChange={(e) => setValidityDays(Number(e.target.value) || 14)}
            />
          </div>
        </CardContent>
      </Card>

      {submitError && <p className="text-destructive text-sm">{submitError}</p>}
      {/* Tombol mati kalau customer belum dipilih — cocok dengan syarat
          server (POST /sph menolak tanpa customer_id), supaya tak ada tombol
          yang kelihatan hidup lalu balas 400. */}
      <Button onClick={() => void submit()} disabled={submitting || cart.length === 0 || !customer}>
        {submitting ? "Menyimpan…" : "Buat Draft SPH"}
      </Button>
    </div>
  );
}
