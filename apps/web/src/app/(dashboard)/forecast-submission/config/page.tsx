"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BufferRow {
  itemId: number;
  itemName: string;
  warehouseKode: string;
  warehouseNama: string;
  bufferQty: number;
  currentQty: number;
}
interface StockItem {
  item_id: string;
  no: string;
  name: string;
}
interface Warehouse {
  kode: string;
  nama: string;
}

export default function ForecastBufferConfigPage() {
  const [rows, setRows] = useState<BufferRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [selectedWh, setSelectedWh] = useState("");
  const [bufferQty, setBufferQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rRes, wRes] = await Promise.all([
        fetch("/api/forecast/buffer-config", { cache: "no-store" }),
        fetch("/api/stock/warehouses?aktif=1", { cache: "no-store" }),
      ]);
      const rData = await rRes.json();
      const wData = await wRes.json();
      if (!rRes.ok) throw new Error(rData.error ?? "gagal memuat config");
      setRows(rData.rows ?? []);
      setWarehouses(wData.warehouses ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [rRes, wRes] = await Promise.all([
          fetch("/api/forecast/buffer-config", { cache: "no-store" }),
          fetch("/api/stock/warehouses?aktif=1", { cache: "no-store" }),
        ]);
        const rData = await rRes.json();
        const wData = await wRes.json();
        if (!active) return;
        if (!rRes.ok) throw new Error(rData.error ?? "gagal memuat config");
        setRows(rData.rows ?? []);
        setWarehouses(wData.warehouses ?? []);
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function searchItems() {
    setSearching(true);
    try {
      const res = await fetch(`/api/stock/branch?q=${encodeURIComponent(q)}&limit=15`, { cache: "no-store" });
      const data = await res.json();
      setResults((data.rows ?? []).map((r: { item_id: string; no: string; name: string }) => ({ item_id: r.item_id, no: r.no, name: r.name })));
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    setSaveError(null);
    if (!selectedItem || !selectedWh || !bufferQty) {
      setSaveError("pilih item, gudang, dan isi buffer dulu");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/forecast/buffer-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: Number(selectedItem.item_id),
          warehouseKode: selectedWh,
          bufferQty: Number(bufferQty),
          updatedBy: "web-ui",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      setSelectedItem(null);
      setSelectedWh("");
      setBufferQty("");
      setResults([]);
      setQ("");
      await load();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup Buffer Stok</h1>
        <p className="text-muted-foreground">
          F19 — safety stock per item per gudang, dipakai sistem sbg salah satu pemicu usulan forecast. Item
          tanpa buffer tidak pernah kena alert (bukan error).
        </p>
        <p className="text-muted-foreground mt-1 text-xs italic">
          ⚠️ Sementara diisi manual — Accurate kemungkinan sudah punya data buffer ini secara native, tapi
          menariknya otomatis butuh ubah kode sinkronisasi Accurate (di luar kewenangan magang). Halaman ini
          pengganti sementara sampai itu tersedia.{" "}
          <Link href="/forecast-submission" className="text-primary underline">
            Kembali ke Forecast Submission
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tambah / Ubah Buffer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cari nama/kode item…" />
            <Button type="button" onClick={() => void searchItems()} disabled={searching}>
              {searching ? "Mencari…" : "Cari"}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-md border">
              {results.map((it) => (
                <button
                  key={it.item_id}
                  type="button"
                  onClick={() => {
                    setSelectedItem(it);
                    setResults([]);
                  }}
                  className="hover:bg-muted block w-full px-3 py-2 text-left text-sm"
                >
                  {it.name} <span className="text-muted-foreground text-xs">({it.no})</span>
                </button>
              ))}
            </div>
          )}
          {selectedItem && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-sm">
                Item: <span className="font-medium">{selectedItem.name}</span>
              </div>
              <div className="min-w-48">
                <Label className="mb-1 block text-xs">Gudang</Label>
                <Select value={selectedWh} onValueChange={(v) => setSelectedWh(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih gudang" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.kode} value={w.kode}>
                        {w.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <Label className="mb-1 block text-xs">Buffer Qty</Label>
                <Input type="number" min={0} value={bufferQty} onChange={(e) => setBufferQty(e.target.value)} />
              </div>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          )}
          {saveError && <p className="text-destructive text-sm">{saveError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buffer Terkonfigurasi ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {loading ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Belum ada buffer dikonfigurasi.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Gudang</TableHead>
                  <TableHead>Buffer</TableHead>
                  <TableHead>Stok Saat Ini</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.itemId}-${r.warehouseKode}`}>
                    <TableCell>{r.itemName}</TableCell>
                    <TableCell>{r.warehouseNama}</TableCell>
                    <TableCell>{r.bufferQty}</TableCell>
                    <TableCell className={r.currentQty <= r.bufferQty ? "text-destructive font-medium" : ""}>
                      {r.currentQty}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
